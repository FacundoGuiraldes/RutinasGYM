// Lesiones y molestias: el socio se lo cuenta a la IA con sus palabras y la app saca de su rutina
// los ejercicios que cargan esa zona. La IA solo interpreta el texto: las zonas son una lista fija
// y qué ejercicios se evitan lo deciden estas reglas (nunca la IA).

const AREAS = {
  rodilla: { label: "Rodilla", words: /rodilla|menisco|ligamento cruzado|rotul/i, avoid: /squat|lunge|jump|leg extension|step[- ]?up|hack|sissy|plyo|burpee|run\b|sprint|box|skater|pistol/i },
  hombro: { label: "Hombro", words: /hombro|manguito|deltoid|clav[ií]cula|esc[aá]pula/i, avoid: /overhead|military|shoulder press|arnold|behind (head|neck)|upright row|dip\b|dips\b|lateral raise|front raise|handstand|snatch|jerk|push press|pull-?over/i },
  lumbar: { label: "Zona lumbar", words: /lumbar|espalda baja|ci[aá]tic|hernia|columna|disco/i, avoid: /deadlift|good morning|bent[- ]over|back extension|hyperextension|sit-?up|russian twist|clean|snatch|jerk|swing|barbell (full |front )?squat|rack pull|superman/i },
  cuello: { label: "Cuello", words: /cuello|cervical|trapecio/i, avoid: /neck|shrug|behind (head|neck)|bridge|headstand|upright row/i },
  codo_muneca: { label: "Codo o muñeca", words: /codo|mu[nñ]eca|epicondil|tendinitis|antebrazo/i, avoid: /skull|french press|wrist|push-?up|dip\b|dips\b|barbell curl|close grip|handstand|clean|snatch|front squat|zottman/i },
  cadera: { label: "Cadera", words: /cadera|ingle|pubalgia|piriforme/i, avoid: /sumo|deep|split squat|bulgarian|hip (thrust|abduction|adduction)|lunge|good morning|frog|butterfly/i },
  tobillo: { label: "Tobillo o pie", words: /tobillo|pie\b|pies\b|esguince|aquiles|fascitis|planta/i, avoid: /jump|calf raise|run\b|sprint|skip|box|plyo|burpee|jack|hop|walk|step[- ]?up/i },
};
const AREA_KEYS = Object.keys(AREAS);

// Sin IA: busca las palabras de cada zona en el texto
function interpretByWords(text) {
  return AREA_KEYS.filter((k) => AREAS[k].words.test(text));
}

// Con IA: devuelve la lista COMPLETA de zonas (la IA ve las actuales y puede sacar las que ya no molestan)
async function interpretLimitations(ai, text, current = []) {
  const byWords = interpretByWords(text);
  const better = /ya no (me )?(duele|molesta)|sin (dolor|molestias)|me recuper|estoy curad|alta m[eé]dica/i.test(text);
  const byRules = () => (better ? current.filter((a) => (byWords.length ? !byWords.includes(a) : false)) : [...new Set([...current, ...byWords])]);
  if (!ai?.enabled) return { areas: byRules(), source: "reglas" };
  try {
    const msg = await ai.chat({
      json: true,
      maxTokens: 300,
      messages: [
        { role: "system", content: `Sos el asistente de un gimnasio. El socio cuenta con sus palabras qué le duele o molesta. Devolvé SOLO JSON: {"areas": [...], "respuesta": "una frase corta y amable en español rioplatense"}. "areas" es la lista COMPLETA de zonas que hay que cuidar ahora, usando únicamente estas claves: ${AREA_KEYS.join(", ")}. Zonas que ya estaban en "actuales" se mantienen salvo que el socio diga que ya no le molestan. Si el texto no habla de dolor o lesión, devolvé las actuales sin cambios. No des diagnósticos ni tratamientos: si es algo serio, sugerí consultar a un médico.` },
        { role: "user", content: JSON.stringify({ actuales: current, texto: text }) },
      ],
    });
    const { extractJson } = require("./ai");
    const parsed = extractJson(msg.content);
    const areas = Array.isArray(parsed?.areas) ? [...new Set(parsed.areas.filter((a) => AREA_KEYS.includes(a)))] : null;
    if (areas) return { areas, reply: typeof parsed.respuesta === "string" ? parsed.respuesta.slice(0, 300) : null, source: "ia" };
  } catch { /* si la IA falla, seguimos con reglas */ }
  return { areas: byRules(), source: "reglas" };
}

const avoidRegex = (areas) => (areas?.length ? new RegExp(areas.map((a) => AREAS[a]?.avoid.source).filter(Boolean).join("|"), "i") : null);
// ¿Este ejercicio (por su nombre en inglés) carga una zona con molestia?
const isBlocked = (name, areas) => Boolean(avoidRegex(areas)?.test(name));
const areaLabels = (areas) => (areas ?? []).filter((a) => AREAS[a]).map((a) => ({ key: a, label: AREAS[a].label }));

module.exports = { AREAS, AREA_KEYS, interpretByWords, interpretLimitations, isBlocked, areaLabels };
