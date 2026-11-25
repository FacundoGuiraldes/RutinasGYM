// Utilidades chicas y sin dependencias: fechas, tokens, texto y azar reproducible.

const crypto = require("node:crypto");

// Argentina no tiene horario de verano: UTC-3 fijo. Se puede cambiar con TZ_OFFSET_MIN.
const OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN ?? -180);

// Fecha local "YYYY-MM-DD" de un instante
function localDate(date = new Date()) {
  return new Date(date.getTime() + OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

// Suma días a una fecha "YYYY-MM-DD"
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Lunes de la semana de esa fecha (la semana de entrenamiento va de lunes a domingo)
function weekStart(dateStr) {
  const dow = (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return addDays(dateStr, -dow);
}

// Token largo e imposible de adivinar para el link personal del socio
function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Comparación en tiempo constante (para claves de admin y tokens)
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// "Martínez" -> "martinez": para buscar sedes sin importar tildes ni mayúsculas
function normalize(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Azar reproducible: la misma semilla da siempre la misma secuencia
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Elige un elemento con probabilidad proporcional a su peso
function weightedPick(items, weightFn, rng) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

module.exports = {
  localDate,
  addDays,
  weekStart,
  randomToken,
  safeEqual,
  normalize,
  hashString,
  mulberry32,
  weightedPick,
};
