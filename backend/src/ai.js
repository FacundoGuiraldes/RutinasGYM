// Cliente mínimo de IA (formato OpenAI: Groq, OpenRouter, Gemini...). Sin la clave, la app sigue funcionando:
// los reemplazos usan el mejor candidato por reglas y el agente admin avisa que no está activo.
//
// Respaldo: si el proveedor principal falla (límite, caída, tiempo agotado) se prueba el de respaldo
// (AI_FALLBACK_API_KEY / AI_FALLBACK_BASE_URL / AI_FALLBACK_MODEL). Tope diario de pedidos: AI_DAILY_LIMIT.

const { AppError } = require("./errors");

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"; // se cambia con AI_MODEL
const DEFAULT_BASE = "https://openrouter.ai/api/v1";

function createAi({
  apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.AI_MODEL || DEFAULT_MODEL,
  baseUrl = process.env.AI_BASE_URL || DEFAULT_BASE,
  fallback = process.env.AI_FALLBACK_API_KEY
    ? { apiKey: process.env.AI_FALLBACK_API_KEY, model: process.env.AI_FALLBACK_MODEL || model, baseUrl: process.env.AI_FALLBACK_BASE_URL || baseUrl }
    : null,
  dailyLimit = Number(process.env.AI_DAILY_LIMIT || 800),
  fetchImpl = globalThis.fetch,
  timeoutMs = 25000,
  now = () => new Date(),
} = {}) {
  const enabled = Boolean(apiKey);
  const usage = { day: null, count: 0, fallbackCount: 0 };

  function spend() {
    const day = now().toISOString().slice(0, 10);
    if (usage.day !== day) Object.assign(usage, { day, count: 0, fallbackCount: 0 });
    if (usage.count >= dailyLimit) throw new AppError(429, "AI_BUDGET", "Se alcanzó el tope diario de consultas a la IA. Probá mañana o pedíselo a tu profe.");
    usage.count++;
  }

  async function callProvider(cfg, { messages, tools, json, maxTokens }) {
    const body = { model: cfg.model, messages, temperature: 0.2, max_tokens: maxTokens };
    if (tools?.length) { body.tools = tools; body.tool_choice = "auto"; }
    if (json) body.response_format = { type: "json_object" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new AppError(502, "AI_ERROR", `La IA respondió ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new AppError(502, "AI_ERROR", "Respuesta de IA vacía");
      return msg;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(502, "AI_ERROR", `No se pudo consultar la IA: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // Devuelve el mensaje del asistente: { content, tool_calls? }
  async function chat({ messages, tools, json = false, maxTokens = 900 }) {
    if (!enabled) throw new AppError(503, "AI_DISABLED", "La IA no está configurada (falta OPENROUTER_API_KEY).");
    spend();
    const args = { messages, tools, json, maxTokens };
    try {
      return await callProvider({ apiKey, model, baseUrl }, args);
    } catch (err) {
      if (!fallback?.apiKey) throw err;
      usage.fallbackCount++;
      return callProvider(fallback, args);
    }
  }

  return { enabled, model, chat, usage: () => ({ ...usage, dailyLimit, hasFallback: Boolean(fallback?.apiKey) }) };
}

// Saca el primer objeto JSON de un texto (algunos modelos lo envuelven en ```json)
function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

module.exports = { createAi, extractJson, DEFAULT_MODEL };
