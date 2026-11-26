// Otra actividad deportiva del socio (fútbol, running, natación...). Cuenta como carga de entrenamiento: si ya se mueve
// varios días por semana, la rutina de gimnasio baja un poco el volumen de lo que ese deporte ya castiga, para que llegue
// a recuperarse. Son reglas, no IA: la lista de deportes y el efecto de cada uno son fijos.

const SPORTS = {
  futbol: { label: "Fútbol", load: "lower" },
  running: { label: "Running", load: "lower" },
  ciclismo: { label: "Ciclismo", load: "lower" },
  natacion: { label: "Natación", load: "upper" },
  tenis_padel: { label: "Tenis o pádel", load: "all" },
  artes_marciales: { label: "Artes marciales o boxeo", load: "all" },
  otro: { label: "Otro deporte", load: "all" },
};
const SPORT_KEYS = Object.keys(SPORTS);
const LOWER = new Set(["cuadriceps", "isquios", "gemelos", "gluteos"]);
const UPPER = new Set(["pecho", "espalda", "hombros", "biceps", "triceps"]);

// Cuánto se multiplica el volumen de una región por la carga extra del otro deporte (1 = sin cambio)
function loadFactor(sport, days, region) {
  const s = SPORTS[sport];
  if (!s || !days) return 1;
  const hit = s.load === "all" || (s.load === "lower" ? LOWER.has(region) : UPPER.has(region));
  if (!hit) return 1;
  return days >= 3 ? 0.75 : days === 2 ? 0.85 : 0.92;
}

const sportLabel = (k) => SPORTS[k]?.label ?? null;
module.exports = { SPORTS, SPORT_KEYS, loadFactor, sportLabel };
