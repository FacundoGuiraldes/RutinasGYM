// Generador de rutinas por REGLAS (sin IA). Funciones puras sobre un "pool" de ejercicios:
// el pool ya viene filtrado por sede (equipamiento disponible, exclusiones, ejercicios habilitados),
// así que es imposible que el generador devuelva algo que la sede no puede hacer.

const { mulberry32, hashString, weightedPick } = require("./util");

const USABLE_ROLES = new Set(["compound", "isolation", "core", "cardio"]);

const DEFAULT_PROG = { setsBonus: 0, extraPerDay: 0, levelBoost: 0, loadStep: 0 };

// Qué tan "normal" es cada equipamiento en un gimnasio: pesa en el sorteo
const EQUIP_WEIGHT = {
  barbell: 3, dumbbell: 3, cable: 3, "leverage machine": 3, "smith machine": 2.5, "body weight": 2.5,
  "ez barbell": 2, kettlebell: 1.5, assisted: 1.5, "sled machine": 1.5, band: 1, "resistance band": 1,
  weighted: 1, rope: 1, "olympic barbell": 1, "trap bar": 1, "stability ball": 0.8, "medicine ball": 0.8,
  "wheel roller": 0.7, "bosu ball": 0.5, "stationary bike": 2, "elliptical machine": 2, "stepmill machine": 2,
  "skierg machine": 1.5, "upper body ergometer": 1,
  // elementos deducidos de ejercicios de peso corporal (ver equipment.js): pesan como peso corporal
  "pull-up bar": 2.5, "dip bars": 2.5, "bench or box": 2.5,
};

// ---------- Slots: "qué hueco hay que llenar" ----------
const SLOTS = {
  chestC: { targets: ["pectorals"], roles: ["compound"], patterns: ["horizontal_push"] },
  chestI: { targets: ["pectorals"], roles: ["isolation"] },
  backV: { targets: ["lats"], roles: ["compound"], patterns: ["vertical_pull"] },
  backH: { targets: ["upper back", "lats"], roles: ["compound"], patterns: ["horizontal_pull"] },
  backI: { targets: ["lats", "upper back"], roles: ["isolation"] },
  delC: { targets: ["delts"], roles: ["compound"], patterns: ["vertical_push"] },
  delSide: { targets: ["delts"], roles: ["isolation"], patterns: ["shoulder_raise"] },
  delRear: { targets: ["delts"], roles: ["isolation", "compound"], patterns: ["rear_delt"] },
  trap: { targets: ["traps"], roles: ["isolation", "compound"] },
  bi: { targets: ["biceps"], roles: ["isolation", "compound"] },
  tri: { targets: ["triceps"], roles: ["isolation", "compound"] },
  quadC: { targets: ["quads", "glutes"], roles: ["compound"], patterns: ["squat"] },
  lunge: { targets: ["quads", "glutes"], roles: ["compound"], patterns: ["lunge"] },
  hingeC: { targets: ["hamstrings", "glutes", "spine"], roles: ["compound"], patterns: ["hinge"] },
  legCurl: { targets: ["hamstrings"], roles: ["isolation"], patterns: ["knee_flexion"] },
  legExt: { targets: ["quads"], roles: ["isolation"], patterns: ["knee_extension"] },
  gluteI: { targets: ["glutes"], roles: ["isolation", "compound"], patterns: ["glute_isolation", "hinge"] },
  calf: { targets: ["calves"], roles: ["isolation", "compound"] },
  abs: { targets: ["abs"], roles: ["core"] },
  cardio: { targets: ["cardiovascular system"], roles: ["cardio"] },
};

// ---------- Plantillas de día ----------
// slots: en orden de prioridad (si el día lleva pocos ejercicios, se cortan los últimos).
// extra: ejercicios adicionales cuando la progresión sube la cantidad por día.
const TEMPLATES = {
  fullA: { name: "Cuerpo completo A", slots: ["quadC", "chestC", "backV", "legCurl", "delSide", "abs", "bi"], extra: ["tri", "calf", "gluteI"] },
  fullB: { name: "Cuerpo completo B", slots: ["hingeC", "delC", "backH", "lunge", "tri", "abs", "calf"], extra: ["bi", "chestI", "delSide"] },
  fullC: { name: "Cuerpo completo C", slots: ["lunge", "chestC", "backH", "legCurl", "bi", "tri", "abs"], extra: ["delSide", "calf", "gluteI"] },
  upperA: { name: "Tren superior A", slots: ["chestC", "backV", "delC", "backH", "bi", "tri", "delSide"], extra: ["chestI", "delRear", "abs"] },
  upperB: { name: "Tren superior B", slots: ["chestC", "backH", "delC", "backV", "chestI", "delRear", "bi", "tri"], extra: ["tri", "bi", "abs"] },
  lowerA: { name: "Tren inferior A", slots: ["quadC", "hingeC", "lunge", "legCurl", "calf", "abs", "gluteI"], extra: ["legExt", "calf"] },
  lowerB: { name: "Tren inferior B", slots: ["hingeC", "quadC", "gluteI", "legExt", "calf", "abs", "lunge"], extra: ["legCurl", "abs"] },
  push: { name: "Empuje (pecho, hombros y tríceps)", slots: ["chestC", "delC", "chestI", "delSide", "tri", "tri"], extra: ["chestC", "delSide"] },
  pull: { name: "Tirón (espalda y bíceps)", slots: ["backV", "backH", "backI", "delRear", "bi", "bi"], extra: ["trap", "backH"] },
  legs: { name: "Piernas y glúteos", slots: ["quadC", "hingeC", "lunge", "legCurl", "legExt", "calf", "abs"], extra: ["gluteI", "calf"] },
};

const SPLITS = {
  2: ["fullA", "fullB"],
  3: ["fullA", "fullB", "fullC"],
  4: ["upperA", "lowerA", "upperB", "lowerB"],
  5: ["push", "pull", "legs", "upperB", "lowerB"],
  6: ["push", "pull", "legs", "push", "pull", "legs"],
};

const BASE_COUNT = { 1: 5, 2: 6, 3: 7 }; // ejercicios por día según nivel (sin contar cardio)
const MAX_PER_DAY = 9;

// ---------- Series, repeticiones y descanso según el enfoque ----------
const SCHEMES = {
  fuerza: { compound: { sets: 4, reps: "4-6", rest: 150 }, isolation: { sets: 3, reps: "8-10", rest: 90 } },
  hipertrofia: { compound: { sets: 4, reps: "8-10", rest: 90 }, isolation: { sets: 3, reps: "10-15", rest: 60 } },
  bajar_grasa: { compound: { sets: 3, reps: "12-15", rest: 45 }, isolation: { sets: 3, reps: "15-20", rest: 40 } },
  general: { compound: { sets: 3, reps: "10-12", rest: 75 }, isolation: { sets: 3, reps: "12-15", rest: 60 } },
};
const FOCUSES = Object.keys(SCHEMES);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function schemeFor(ex, { focus, level, prog }) {
  const table = SCHEMES[focus] ?? SCHEMES.general;
  if (ex.role === "cardio") {
    return { sets: 1, reps: focus === "bajar_grasa" ? "15-20 min" : "10-15 min", rest: null, note: "Ritmo moderado: tenés que poder hablar entrecortado." };
  }
  if (ex.role === "core") {
    const stability = ex.pattern === "core_stability";
    return { sets: 3, reps: stability ? "30-45 s" : "12-20", rest: 45, note: null };
  }
  const base = table[ex.role === "compound" ? "compound" : "isolation"];
  let sets = base.sets;
  let reps = base.reps;
  if (ex.role === "compound") {
    if (level === 1) {
      sets = Math.min(sets, 3);
      if (focus === "fuerza") reps = "6-8"; // un principiante no arranca con series de 4-6 pesadas
    }
    sets = clamp(sets + prog.setsBonus, 2, 5);
  } else if (prog.setsBonus >= 2) {
    sets = clamp(sets + 1, 2, 4);
  }
  const notes = [];
  if (ex.role === "compound" && level === 1) notes.push("Priorizá la técnica y dejá 2-3 repeticiones en reserva.");
  if (prog.loadStep > 0 && ex.role === "compound") {
    notes.push("Si completás todas las series con buena técnica, subí un escalón de carga respecto del mes pasado.");
  }
  return { sets, reps, rest: base.rest, note: notes.join(" ") || null };
}

// ---------- Selección ----------

// Candidatos para un slot, relajando criterios de a poco si no hay ninguno:
// 1) rol + patrón exactos, 2) solo rol, 3) cualquier ejercicio usable del músculo.
function pickForSlot(pool, slot, { effLevel, dayUsed, routineUsed, prevIds, rng }) {
  const base = pool.filter((e) => USABLE_ROLES.has(e.role) && e.level <= effLevel && slot.targets.includes(e.target));
  const tiers = [
    (e) => (!slot.roles || slot.roles.includes(e.role)) && (!slot.patterns || slot.patterns.includes(e.pattern)),
    (e) => !slot.roles || slot.roles.includes(e.role),
    () => true,
  ];
  for (const tier of tiers) {
    const cands = base.filter(tier).filter((e) => !dayUsed.has(e.id));
    if (!cands.length) continue;
    const fresh = cands.filter((e) => !routineUsed.has(e.id));
    const list = fresh.length ? fresh : cands;
    return weightedPick(
      list,
      (e) => (EQUIP_WEIGHT[e.equipment] ?? 0.3) * (e.level === effLevel ? 3 : 1) * (prevIds.has(e.id) ? 0.25 : 1),
      rng
    );
  }
  return null;
}

/**
 * Genera las rutinas del ciclo.
 * @param pool        ejercicios disponibles en la sede (ver loadPool)
 * @param member      { id, level 1..3, daysPerWeek 2..6, focus }
 * @param cycleNumber 1, 2, 3... (cambia la semilla: cada mes salen ejercicios distintos)
 * @param prog        estado de progresión { setsBonus, extraPerDay, levelBoost, loadStep }
 * @param prevIds     Set con los ejercicios del ciclo anterior (se evita repetirlos)
 */
function generateRoutine({ pool, member, cycleNumber = 1, prog = {}, prevIds = new Set() }) {
  const p = { ...DEFAULT_PROG, ...prog };
  const focus = FOCUSES.includes(member.focus) ? member.focus : "general";
  const split = SPLITS[member.daysPerWeek];
  if (!split) throw new Error(`daysPerWeek inválido: ${member.daysPerWeek} (debe ser 2 a 6)`);
  if (![1, 2, 3].includes(member.level)) throw new Error(`level inválido: ${member.level} (debe ser 1, 2 o 3)`);

  const effLevel = Math.min(3, member.level + p.levelBoost);
  const rng = mulberry32(hashString(`${member.id}:${cycleNumber}`));
  const routineUsed = new Set();
  const warnings = [];
  const count = Math.min(MAX_PER_DAY, BASE_COUNT[member.level] + p.extraPerDay);

  const days = split.map((tplKey, i) => {
    const tpl = TEMPLATES[tplKey];
    const slotNames = [...tpl.slots];
    // Si la progresión pide más ejercicios que los slots base, se suman los "extra" de la plantilla
    for (let k = 0; slotNames.length < count && k < 12; k++) slotNames.push(tpl.extra[k % tpl.extra.length]);

    const dayUsed = new Set();
    const exercises = [];
    const ctx = { effLevel, dayUsed, routineUsed, prevIds, rng };
    const fill = (slotName) => {
      const ex = pickForSlot(pool, SLOTS[slotName], ctx);
      if (!ex) return false;
      dayUsed.add(ex.id);
      routineUsed.add(ex.id);
      const s = schemeFor(ex, { focus, level: member.level, prog: p });
      exercises.push({ exerciseId: ex.id, position: exercises.length + 1, sets: s.sets, reps: s.reps, restSec: s.rest, note: s.note });
      return true;
    };

    // Llenamos hasta "count" ejercicios; si un slot no se puede (la sede no tiene el equipo), seguimos con el siguiente
    for (const name of slotNames) {
      if (exercises.length >= count) break;
      if (!fill(name)) warnings.push(`Día ${i + 1}: no hubo ejercicio disponible para "${name}"`);
    }
    // Bajar grasa: cierre con cardio
    if (focus === "bajar_grasa") fill("cardio");

    return { dayIndex: i + 1, label: `Día ${i + 1} – ${tpl.name}`, exercises };
  });

  return {
    days,
    warnings,
    params: { level: member.level, daysPerWeek: member.daysPerWeek, focus, effLevel, cycleNumber, prog: p },
  };
}

// Ejercicios usables de la sede: habilitados, con equipamiento disponible y sin exclusión de la sede
async function loadPool(db, sedeId) {
  const { rows } = await db.query(
    `SELECT e.id, e.name, e.body_part, e.target, e.secondary_muscles, e.role,
            e.movement_pattern AS pattern, e.level, q.key AS equipment
     FROM exercises e
     JOIN equipment q ON q.id = e.equipment_id
     JOIN sede_equipment se ON se.equipment_id = e.equipment_id AND se.sede_id = $1 AND se.available
     WHERE e.enabled
       AND e.role IS NOT NULL AND e.level IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sede_exclusions x WHERE x.sede_id = $1 AND x.exercise_id = e.id)`,
    [sedeId]
  );
  return rows.map((r) => ({ ...r, secondary: r.secondary_muscles ?? [] }));
}

module.exports = {
  generateRoutine,
  loadPool,
  schemeFor,
  pickForSlot,
  USABLE_ROLES,
  DEFAULT_PROG,
  SLOTS,
  TEMPLATES,
  SPLITS,
  FOCUSES,
};
