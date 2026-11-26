// Volumen semanal por región muscular y objetivos según la evidencia.
//
// Cómo se cuenta (Pelland et al. 2024, meta-regresión con 67 estudios): una serie directa vale 1 y una serie que
// trabaja el músculo de forma indirecta (el tríceps en un press de banco) vale 0,5 ("series fraccionales").
//
// Qué objetivo se busca por semana y por región:
//  - Ganar músculo: mínimo 10 series (Schoenfeld 2017: respuesta dosis-efecto, el beneficio más claro está en 10 o más)
//    y óptimo 12 a 20 (Baz-Valle 2022); más allá de ~31 no hay ventaja detectable (Pelland 2024). El techo es 22 (26 en zonas prioritarias): sobra margen sobre el óptimo y evita fatiga que no rinde.
//  - General: al menos 4 series por músculo ya mejora fuerza y masa con poco tiempo (Iversen 2021); apuntamos a 6 a 12.
//  - Bajar grasa: el volumen que mantiene el músculo es bastante menor que el que lo hace crecer; 6 a 12 con cargas moderadas.
//  - Fuerza: la fuerza muestra rendimientos decrecientes mucho más marcados que la hipertrofia (Pelland 2024): 6 a 12.
//  - Frecuencia: dos veces por semana por músculo supera a una a igual volumen (Schoenfeld 2016); ya la garantizan las plantillas.

const CONTRIB = {
  horizontal_push: { pecho: 1, triceps: 0.5, hombros: 0.5 },
  vertical_push: { hombros: 1, triceps: 0.5 },
  horizontal_pull: { espalda: 1, biceps: 0.5 },
  vertical_pull: { espalda: 1, biceps: 0.5 },
  squat: { cuadriceps: 1, gluteos: 0.5 },
  lunge: { cuadriceps: 1, gluteos: 0.5 },
  hinge: { isquios: 1, gluteos: 0.5 },
  knee_flexion: { isquios: 1 },
  knee_extension: { cuadriceps: 1 },
  glute_isolation: { gluteos: 1 },
  hip_abduction: { gluteos: 0.5 },
  shoulder_raise: { hombros: 1 },
  rear_delt: { hombros: 1 },
};
const BY_TARGET = {
  pectorals: { pecho: 1 }, lats: { espalda: 1 }, "upper back": { espalda: 1 }, delts: { hombros: 1 }, biceps: { biceps: 1 }, triceps: { triceps: 1 },
  quads: { cuadriceps: 1 }, hamstrings: { isquios: 1 }, glutes: { gluteos: 1 }, calves: { gemelos: 1 },
};

// Regiones que se controlan (abdomen, trapecios y antebrazos quedan afuera: se trabajan de forma indirecta o con poco volumen)
const REGIONS = ["pecho", "espalda", "hombros", "biceps", "triceps", "cuadriceps", "isquios", "gluteos", "gemelos"];
// Las regiones chicas llegan a lo suyo con menos series (los tres compuestos ya las trabajan de forma indirecta)
const SMALL = new Set(["biceps", "triceps", "gemelos", "hombros"]);

const { loadFactor } = require("./sports");

const TARGETS = {
  hipertrofia: { min: 10, max: 22, minSmall: 8, maxPriority: 26 },
  general: { min: 6, max: 14, minSmall: 4, maxPriority: 14 },
  bajar_grasa: { min: 6, max: 14, minSmall: 4, maxPriority: 14 },
  fuerza: { min: 6, max: 14, minSmall: 4, maxPriority: 14 },
};

function contributions(ex) {
  return CONTRIB[ex.pattern] ?? BY_TARGET[ex.target] ?? {};
}

// days: [{ exercises: [{ exerciseId, sets }] }]; poolById: Map id -> ejercicio del pool
function weeklyVolume(days, poolById) {
  const vol = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  for (const d of days) for (const x of d.exercises) {
    const ex = poolById.get(x.exerciseId);
    if (!ex || ex.role === "cardio") continue;
    for (const [region, w] of Object.entries(contributions(ex))) vol[region] += w * x.sets;
  }
  return vol;
}

// Con 2 o 3 días por semana no hay tiempo físico para llegar al mínimo de 10 series por músculo: se baja al mínimo
// que la evidencia ya considera útil (4 o más series, Iversen 2021) y los gemelos solo se exigen con 5 o más días.
function rangeFor(focus, region, { priority = false, daysPerWeek = 4, sport = null, sportDays = 0 } = {}) {
  const t = TARGETS[focus] ?? TARGETS.general;
  let min = SMALL.has(region) ? t.minSmall : t.min;
  if (daysPerWeek <= 3) min = Math.max(4, Math.round(min * 0.6));
  if (region === "gemelos") min = daysPerWeek >= 5 ? Math.min(min, 6) : 0;
  if (priority && daysPerWeek >= 3) min += 2; // una zona prioritaria no se conforma con el mínimo: +2 series
  const f = loadFactor(sport, sportDays, region); // otro deporte: baja el volumen de lo que ya castiga
  if (f < 1 && min > 0) min = Math.max(3, Math.round(min * f));
  return { min, max: Math.round((priority ? t.maxPriority : t.max) * f) };
}

// Qué regiones cuentan como cada zona prioritaria
const ZONE_REGIONS = { pecho: ["pecho"], espalda: ["espalda"], hombros: ["hombros"], brazos: ["biceps", "triceps"], piernas: ["cuadriceps", "isquios", "gemelos"], gluteos: ["gluteos"], abdomen: [] };

module.exports = { CONTRIB, REGIONS, SMALL, TARGETS, ZONE_REGIONS, contributions, weeklyVolume, rangeFor };
