// Cliente mínimo de IA (OpenRouter, formato OpenAI). Sin la clave, la app sigue funcionando:
// los reemplazos usan el mejor candidato por reglas y el agente admin avisa que no está activo.

const { AppError } = require("./errors");

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5"; // se cambia con AI_MODEL

function createAi({
  apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.AI_MODEL || DEFAULT_MODEL,
  baseUrl = process.env.AI_BASE_URL || "https://openrouter.ai/api/v1",
  fetchImpl = globalThis.fetch,
  timeoutMs = 25000,
} = {}) {
  const enabled = Boolean(apiKey);

  // Devuelve el mensaje del asistente: { content, tool_calls? }
  async function chat({ messages, tools, json = false, maxTokens = 900 }) {
    if (!enabled) throw new AppError(503, "AI_DISABLED", "La IA no está configurada (falta OPENROUTER_API_KEY).");
    const body = { model, messages, temperature: 0.2, max_tokens: maxTokens };
    if (tools?.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (json) body.response_format = { type: "json_object" };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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

  return { enabled, model, chat };
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
