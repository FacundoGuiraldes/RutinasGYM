// Generador de rutinas por REGLAS (sin IA). Funciones puras sobre un "pool" de ejercicios:
// el pool ya viene filtrado por sede (equipamiento disponible, exclusiones, ejercicios habilitados),
// así que es imposible que el generador devuelva algo que la sede no puede hacer.

const { mulberry32, hashString, weightedPick } = require("./util");
const { isBlocked } = require("./limitations");

const USABLE_ROLES = new Set(["compound", "isolation", "core", "cardio"]);

const { equipmentWeight } = require("./equipment");

const DEFAULT_PROG = { setsBonus: 0, extraPerDay: 0, levelBoost: 0, loadStep: 0 };


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
const MAX_PER_DAY_PRIORITY = 11; // con zonas prioritarias el día puede llevar un par más
const SESSION_DELTA = { 45: -1, 60: 0, 75: 1 }; // minutos por sesión -> ejercicios de más o de menos
const SESSION_MINUTES = Object.keys(SESSION_DELTA).map(Number);

// Hipertrofia: cada músculo se entrena 2 veces por semana (lo que mejor funciona con volumen moderado).
// Con 3 días y nivel intermedio o avanzado: superior, inferior y cuerpo completo.
function splitFor({ daysPerWeek, focus, level }) {
  if (focus === "hipertrofia" && daysPerWeek === 3 && level >= 2) return ["upperA", "lowerA", "fullC"];
  return SPLITS[daysPerWeek];
}

// ---------- Zonas prioritarias (hipertrofia) ----------
// slots: ejercicios de la zona dentro de los días; lead: el que va primero (con el músculo fresco);
// extra: series de más para esa zona; targets: músculos del dataset que cuentan como la zona.
const ZONES = {
  pecho: { label: "Pecho", lead: "chestC", slots: ["chestC", "chestI"], extra: ["chestI", "chestC"], targets: ["pectorals"] },
  espalda: { label: "Espalda", lead: "backV", slots: ["backV", "backH", "backI"], extra: ["backI", "backH"], targets: ["lats", "upper back", "traps"] },
  hombros: { label: "Hombros", lead: "delC", slots: ["delC", "delSide", "delRear"], extra: ["delSide", "delRear"], targets: ["delts"] },
  brazos: { label: "Brazos", lead: "bi", slots: ["bi", "tri"], extra: ["tri", "bi"], targets: ["biceps", "triceps", "forearms"] },
  piernas: { label: "Piernas", lead: "quadC", slots: ["quadC", "legExt", "legCurl", "lunge", "hingeC", "calf"], extra: ["legExt", "legCurl"], targets: ["quads", "hamstrings", "calves", "adductors", "abductors"] },
  gluteos: { label: "Glúteos", lead: "hingeC", slots: ["gluteI", "hingeC", "lunge"], extra: ["gluteI", "gluteI"], targets: ["glutes"] },
  abdomen: { label: "Abdomen", lead: "abs", slots: ["abs"], extra: ["abs"], targets: ["abs"] },
};
const ZONE_KEYS = Object.keys(ZONES);
const MAX_PRIORITIES = 2;

// Si el socio no eligió prioridad (por ejemplo lo cargó el profe sin ese dato), el género sugiere un énfasis habitual.
const GENDER_DEFAULT_PRIORITIES = { mujer: ["gluteos", "piernas"], hombre: ["pecho", "hombros"] };

function resolvePriorities({ focus, priorities, gender }) {
  if (focus !== "hipertrofia") return { list: [], source: null };
  if (Array.isArray(priorities)) {
    const list = [...new Set(priorities)].filter((z) => ZONES[z]).slice(0, MAX_PRIORITIES);
    return { list, source: "member" }; // lista vacía = "parejo": sin énfasis
  }
  return { list: GENDER_DEFAULT_PRIORITIES[gender] ?? [], source: "gender" };
}

// Que cada zona prioritaria se entrene al menos 2 veces por semana
function ensureFrequency(daySlots, priorities) {
  for (const z of priorities) {
    const zone = ZONES[z];
    const has = (names) => names.some((n) => zone.slots.includes(n));
    let freq = daySlots.filter(has).length;
    const without = daySlots.map((names, i) => ({ names, i })).filter((d) => !has(d.names)).sort((a, b) => a.names.length - b.names.length);
    while (freq < 2 && without.length) {
      const d = without.shift();
      daySlots[d.i] = [...d.names, zone.lead, zone.extra[0]];
      freq++;
    }
  }
}

// En cada día que entrena la zona: su ejercicio principal va primero y se suman ejercicios de volumen.
function applyPriorities(names, priorities, level) {
  let out = [...names];
  let added = 0;
  const extras = level === 1 ? 1 : 2;
  for (const z of [...priorities].reverse()) { // al revés: la primera prioridad queda primera
    const zone = ZONES[z];
    if (!out.some((n) => zone.slots.includes(n))) continue;
    const li = out.indexOf(zone.lead);
    if (li > 0) { out.splice(li, 1); out.unshift(zone.lead); }
    let last = -1;
    out.forEach((n, i) => { if (zone.slots.includes(n)) last = i; });
    out.splice(last + 1, 0, ...zone.extra.slice(0, extras));
    added += extras;
  }
  return { names: out, added };
}

// Minutos estimados de una sesión, como pasa en una sala real:
//  - 5 min de entrada en calor general
//  - por ejercicio: 60 s para acomodarse o cargar la máquina + series x (45 s de trabajo + descanso)
//  - el primer ejercicio pesado lleva 2 series de aproximación (~3 min)
function estimateMinutes(exercises) {
  let sec = 5 * 60;
  exercises.forEach((e, i) => {
    sec += e.restSec == null ? 12 * 60 : 60 + e.sets * (45 + e.restSec);
    if (i === 0 && e.restSec != null && e.restSec >= 90) sec += 150;
  });
  return Math.round(sec / 60 / 5) * 5;
}

// ---------- Series, repeticiones y descanso según el enfoque ----------
const SCHEMES = {
  fuerza: { compound: { sets: 4, reps: "4-6", rest: 150 }, isolation: { sets: 3, reps: "8-10", rest: 90 } },
  hipertrofia: { compound: { sets: 4, reps: "8-10", rest: 90 }, isolation: { sets: 3, reps: "10-15", rest: 60 } },
  bajar_grasa: { compound: { sets: 3, reps: "12-15", rest: 45 }, isolation: { sets: 3, reps: "15-20", rest: 40 } },
  general: { compound: { sets: 3, reps: "10-12", rest: 75 }, isolation: { sets: 3, reps: "12-15", rest: 60 } },
};
const FOCUSES = Object.keys(SCHEMES);

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Hipertrofia: lo pesado primero, volumen moderado, aislados a más repeticiones y la zona prioritaria con una serie más.
function hypertrophyScheme(ex, { level, prog, isPriority, first }) {
  const notes = [];
  let sets, reps, rest;
  if (ex.role === "compound") {
    const heavy = first && level >= 2;
    sets = heavy ? 4 : 3;
    reps = heavy ? "6-8" : "8-12";
    rest = heavy ? 120 : 90; // los pesados piden más pausa para sostener las repeticiones
    if (level === 1) { sets = 3; reps = "8-12"; notes.push("Priorizá la técnica y dejá 2-3 repeticiones en reserva."); }
    sets = clamp(sets + prog.setsBonus + (isPriority ? 1 : 0), 2, 5);
    if (first && level >= 2) notes.push("En la última serie dejá 1-2 repeticiones en reserva.");
    if (prog.loadStep > 0) notes.push("Si completás todas las series con buena técnica, subí un escalón de carga respecto del mes pasado.");
  } else {
    const high = ex.pattern === "shoulder_raise" || ex.pattern === "rear_delt" || ex.target === "calves";
    sets = clamp(3 + (prog.setsBonus >= 2 ? 1 : 0) + (isPriority ? 1 : 0), 2, 5);
    reps = high ? "12-20" : "10-15";
    rest = high ? 60 : 75; // con más de 60 s entre series se rinde un poco mejor; pasados los 90 s ya no hay diferencia
    notes.push(isPriority ? "Recorrido completo y controlá la fase de estiramiento. Terminá cerca del fallo (1-2 repeticiones en reserva)." : "Recorrido completo y controlado, con 1-3 repeticiones en reserva.");
  }
  return { sets, reps, rest, note: notes.join(" ") || null };
}

function schemeFor(ex, { focus, level, prog, isPriority = false, first = false }) {
  if (focus === "hipertrofia" && (ex.role === "compound" || ex.role === "isolation")) {
    return hypertrophyScheme(ex, { level, prog, isPriority, first });
  }
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

// Ejercicios que cargan el músculo en posición estirada (long muscle length). La evidencia reciente
// los favorece para hipertrofia, así que en ese enfoque pesan más al sortear entre candidatos.
const LENGTHENED = /incline (dumbbell |barbell |cable )?(press|curl|fly|flye)|romanian|stiff[- ]leg|good morning|overhead (triceps )?extension|french press|skull ?crusher|pull-?over|\bfly\b|\bflye\b|seated leg curl|lying leg curl|preacher curl|hack squat|bulgarian|split squat|front squat|full squat|cable crossover|\bdip\b|calf raise/i;
// Ejercicios raros, de rehabilitación o demasiado livianos para el objetivo: se evitan salvo que no haya otra opción.
const ODD = /\b(clock|cuban|stork|typewriter|archer|spider|dip cage|self assisted|inverse|isometric|bosu|behind (head|neck)|jefferson|zercher|bradford|sissy|pistol|bottoms|drag curl|on knees|kneeling push|wall|sphinx|stability ball|exercise ball|suspended|towel|poles?|modified|bench pull-?ups?|pelvic tilt|glute bridge|low glute|squat row|front raise|v\. 2)\b/i;
const FILLER = /\b(front raise|wrist|finger|forearm|neck|plate|kickback|side bend|twist|rotation|jack ?knife|v-up)\b/i;
const CANON = /^(barbell|dumbbell|smith|lever|cable|sled)?\s*(incline |decline )?(bench press|chest press|squat|full squat|front squat|romanian deadlift|deadlift|shoulder press|seated shoulder press|military press|bent over row|seated row|row|lat pulldown|pulldown|leg press|hip thrust|pull-?up|chin-?up|biceps curl|hammer curl|preacher curl|triceps extension|pushdown|lateral raise|leg curl|leg extension|calf raise|fly|lunge|crunch|leg raise)\b/i;
function qualityWeight(e, focus) {
  let w = 1;
  if (ODD.test(e.name)) w *= 0.08;
  // Para ganar músculo o fuerza: la banda elástica y el peso corporal en aislados rinden poco (no hay cómo cargarlos)
  if (focus === "hipertrofia" || focus === "fuerza") {
    if (/band/.test(e.equipment)) w *= 0.12;
    if (e.equipment === "body weight" && e.role === "isolation") w *= 0.15;
    if (e.role === "compound" && e.equipment === "body weight" && /push-?up|crunch|sit-?up/i.test(e.name)) w *= 0.3;
  }
  if (focus === "hipertrofia" && FILLER.test(e.name) && e.target !== "abs") w *= 0.2;
  // Peso corporal como ejercicio principal: solo sirven las dominadas, fondos y remos invertidos (se pueden hacer difíciles)
  if (e.role === "compound" && e.equipment === "body weight" && !/pull-?up|chin-?up|\bdips?\b|inverted row|muscle-?up/i.test(e.name) && focus !== "bajar_grasa") w *= 0.25;
  if (/good morning|scott press|full can|hammer press|off dumbbell|reverse grip|wide squat|side split/i.test(e.name)) w *= 0.25;
  // Los básicos que arman una rutina de verdad
  if (focus !== "bajar_grasa" && CANON.test(e.name)) w *= 2.5;
  return w;
}
const lengthenedBoost = (e, focus) => (focus === "hipertrofia" && LENGTHENED.test(e.name) ? 3.5 : 1);

// Candidatos para un slot, relajando criterios de a poco si no hay ninguno:
// 1) rol + patrón exactos, 2) solo rol, 3) cualquier ejercicio usable del músculo.
function pickForSlot(pool, slot, { effLevel, dayUsed, routineUsed, prevIds, rng, focus }) {
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
    // Preferimos no repetir, pero no a costa de calidad: si lo "nuevo" es una rareza y hay un buen ejercicio ya usado, se repite ese
    const good = (arr) => arr.some((e) => qualityWeight(e, focus) >= 0.3);
    const list = fresh.length && (good(fresh) || !good(cands)) ? fresh : cands;
    return weightedPick(
      list,
      (e) => equipmentWeight(e.equipment) * (e.level === effLevel ? 3 : 1) * (prevIds.has(e.id) ? 0.25 : 1) * lengthenedBoost(e, focus) * qualityWeight(e, focus),
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
  const split = splitFor({ daysPerWeek: member.daysPerWeek, focus, level: member.level });
  if (!split) throw new Error(`daysPerWeek inválido: ${member.daysPerWeek} (debe ser 2 a 6)`);
  if (![1, 2, 3].includes(member.level)) throw new Error(`level inválido: ${member.level} (debe ser 1, 2 o 3)`);
  const sessionMinutes = SESSION_MINUTES.includes(Number(member.sessionMinutes)) ? Number(member.sessionMinutes) : 60;

  const effLevel = Math.min(3, member.level + p.levelBoost);
  const rng = mulberry32(hashString(`${member.id}:${cycleNumber}`));
  const routineUsed = new Set();
  const poolById = new Map(pool.map((e) => [e.id, e]));
  const warnings = [];
  const baseCount = clamp(BASE_COUNT[member.level] + SESSION_DELTA[sessionMinutes], 4, MAX_PER_DAY);
  const { list: priorities, source: prioritiesSource } = resolvePriorities({ focus, priorities: member.priorities, gender: member.gender });
  const priorityTargets = new Set(priorities.flatMap((z) => ZONES[z].targets));

  // Slots de cada día (con extras si la progresión pide más ejercicios) y, en hipertrofia, ajustados a las prioridades
  const daySlots = split.map((tplKey) => {
    const tpl = TEMPLATES[tplKey];
    const names = [...tpl.slots];
    for (let k = 0; names.length < baseCount && k < 12; k++) names.push(tpl.extra[k % tpl.extra.length]);
    return names;
  });
  if (priorities.length) ensureFrequency(daySlots, priorities);

  const days = split.map((tplKey, i) => {
    const tpl = TEMPLATES[tplKey];
    let slotNames = daySlots[i];
    let count = baseCount;
    if (priorities.length) {
      const r = applyPriorities(slotNames, priorities, member.level);
      slotNames = r.names;
      count = Math.min(MAX_PER_DAY_PRIORITY, baseCount + r.added);
    }

    const dayUsed = new Set();
    const exercises = [];
    const ctx = { effLevel, dayUsed, routineUsed, prevIds, rng, focus };
    const fill = (slotName) => {
      const ex = pickForSlot(pool, SLOTS[slotName], ctx);
      if (!ex) return false;
      dayUsed.add(ex.id);
      routineUsed.add(ex.id);
      const s = schemeFor(ex, { focus, level: member.level, prog: p, isPriority: priorityTargets.has(ex.target), first: exercises.length === 0 });
      exercises.push({ exerciseId: ex.id, position: exercises.length + 1, sets: s.sets, reps: s.reps, restSec: s.rest, note: s.note });
      return true;
    };

    // Llenamos hasta "count" ejercicios; si un slot no se puede (la sede no tiene el equipo), seguimos con el siguiente
    for (const name of slotNames) {
      if (exercises.length >= count) break;
      if (!fill(name)) warnings.push(`Día ${i + 1}: no hubo ejercicio disponible para "${name}"`);
    }
    // Ajuste al tiempo que pidió el socio: se suman ejercicios si sobra tiempo y se sacan si falta
    if (focus !== "fuerza" || true) {
      const target = sessionMinutes;
      const cap = priorities.length ? MAX_PER_DAY_PRIORITY : MAX_PER_DAY;
      const extras = [...tpl.extra, ...tpl.slots];
      for (let k = 0; k < 12 && exercises.length < cap && estimateMinutes(exercises) < target - 7; k++) fill(extras[k % extras.length]);
      // Al recortar, cada músculo conserva al menos un ejercicio en el día:
      //  1) sale primero lo repetido de zonas NO prioritarias, 2) después el exceso de las prioritarias (más de 3 por músculo),
      //  3) si igual se pasa por mucho, lo último. Así la zona prioritaria sigue siendo la que más trabaja.
      const floor = focus === "fuerza" && target <= 45 ? 3 : 4;
      const tgt = (x) => poolById.get(x.exerciseId)?.target;
      const timesOf = (t) => exercises.filter((x) => tgt(x) === t).length;
      const dropAt = (idx) => { dayUsed.delete(exercises[idx].exerciseId); exercises.splice(idx, 1); };
      while (exercises.length > floor) {
        const over = estimateMinutes(exercises) - target;
        if (over <= 7) break;
        let idx = -1;
        if (!priorities.length) idx = exercises.length - 1; // sin prioridades: simplemente lo último
        for (let k = exercises.length - 1; k > 0 && idx === -1; k--) if (!priorityTargets.has(tgt(exercises[k])) && timesOf(tgt(exercises[k])) > 1) idx = k;
        for (let k = exercises.length - 1; k > 0 && idx === -1; k--) if (priorityTargets.has(tgt(exercises[k])) && timesOf(tgt(exercises[k])) > 3) idx = k;
        if (idx === -1 && over > 25) idx = exercises.length - 1;
        if (idx === -1) break;
        dropAt(idx);
      }
      exercises.forEach((x, k) => { x.position = k + 1; });
      // La progresión mensual suma (o saca) ejercicios por día encima de lo que entra en el tiempo pedido
      for (let k = 0; k < p.extraPerDay; k++) fill(extras[k % extras.length]);
      for (let k = 0; k > p.extraPerDay && exercises.length > 3; k--) { const last = exercises.pop(); dayUsed.delete(last.exerciseId); }
    }
    // Bajar grasa: cierre con cardio
    if (focus === "bajar_grasa") fill("cardio");

    return { dayIndex: i + 1, label: `Día ${i + 1} – ${tpl.name}`, exercises, estMinutes: estimateMinutes(exercises) };
  });

  return {
    days,
    warnings,
    params: { level: member.level, daysPerWeek: member.daysPerWeek, focus, effLevel, cycleNumber, prog: p, sessionMinutes, priorities, prioritiesSource, gender: member.gender ?? null },
  };
}

// Ejercicios usables de la sede: habilitados, con equipamiento disponible y sin exclusión de la sede
async function loadPool(db, sedeId, { limitations = [] } = {}) {
  const { rows } = await db.query(
    `SELECT e.id, e.name, e.name_es, e.body_part, e.target, e.secondary_muscles, e.role,
            e.movement_pattern AS pattern, e.level, q.key AS equipment
     FROM exercises e
     JOIN equipment q ON q.id = e.equipment_id
     JOIN sede_equipment se ON se.equipment_id = e.equipment_id AND se.sede_id = $1 AND se.available
     WHERE e.enabled
       AND (e.extra_equipment_id IS NULL OR EXISTS (
             SELECT 1 FROM sede_equipment s2 WHERE s2.sede_id = $1 AND s2.equipment_id = e.extra_equipment_id AND s2.available))
       AND e.role IS NOT NULL AND e.level IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM sede_exclusions x WHERE x.sede_id = $1 AND x.exercise_id = e.id)`,
    [sedeId]
  );
  const ok = rows.filter((r) => !isBlocked(r.name, limitations));
  return ok.map((r) => ({ ...r, secondary: r.secondary_muscles ?? [] }));
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
  ZONES,
  ZONE_KEYS,
  MAX_PRIORITIES,
  SESSION_MINUTES,
  estimateMinutes,
};
