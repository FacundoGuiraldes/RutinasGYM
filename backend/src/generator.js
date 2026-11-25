// Generador de rutinas por REGLAS (sin IA). Funciones puras sobre un "pool" de ejercicios:
// el pool ya viene filtrado por sede (equipamiento disponible, exclusiones, ejercicios habilitados),
// así que es imposible que el generador devuelva algo que la sede no puede hacer.

const { mulberry32, hashString, weightedPick } = require("./util");
const { isBlocked } = require("./limitations");
const { staple, isJunk } = require("./staples");
const { canonRank } = require("./canon");
const { weeklyVolume, rangeFor, contributions, ZONE_REGIONS, REGIONS } = require("./volume");
const { evaluateRoutine, qualityCost, isMain } = require("./quality");

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
  delSide: { targets: ["delts"], roles: ["isolation"], patterns: ["shoulder_raise"], nameRe: /lateral raise/i, notRe: /rear|reverse|front/i },
  delRear: { targets: ["delts"], roles: ["isolation", "compound"], patterns: ["rear_delt"], nameRe: /rear|reverse fly|face pull/i },
  trap: { targets: ["traps"], roles: ["isolation", "compound"] },
  bi: { targets: ["biceps"], roles: ["isolation", "compound"] },
  tri: { targets: ["triceps"], roles: ["isolation", "compound"] },
  quadC: { targets: ["quads", "glutes"], roles: ["compound"], patterns: ["squat"] },
  lunge: { targets: ["quads", "glutes"], roles: ["compound"], patterns: ["lunge"] },
  hingeC: { targets: ["hamstrings", "glutes", "spine"], roles: ["compound"], patterns: ["hinge"] },
  legCurl: { targets: ["hamstrings"], roles: ["isolation"], patterns: ["knee_flexion"] },
  legExt: { targets: ["quads"], roles: ["isolation"], patterns: ["knee_extension"] },
  gluteI: { targets: ["glutes", "abductors"], roles: ["isolation", "compound"], patterns: ["glute_isolation", "hinge", "hip_abduction"] },
  calf: { targets: ["calves"], roles: ["isolation", "compound"] },
  abs: { targets: ["abs"], roles: ["core"] },
  cardio: { targets: ["cardiovascular system"], roles: ["cardio"] },
};

for (const [k, v] of Object.entries(SLOTS)) v.canon = k; // cada hueco sabe qué lista del canon le corresponde

// ---------- Plantillas de día ----------
// slots: en orden de prioridad (si el día lleva pocos ejercicios, se cortan los últimos).
// extra: ejercicios adicionales cuando la progresión sube la cantidad por día.
const TEMPLATES = {
  fullA: { name: "Cuerpo completo A", slots: ["quadC", "chestC", "backV", "legCurl", "delSide", "abs", "bi"], extra: ["tri", "calf", "gluteI"] },
  // Cuerpo completo: pecho, espalda, hombros y piernas aparecen en cada día de los que haya, para llegar a 2 veces por semana con 2 días
  fullB: { name: "Cuerpo completo B", slots: ["hingeC", "chestC", "backH", "delC", "lunge", "tri", "calf", "abs"], extra: ["bi", "chestI", "delSide"] },
  fullC: { name: "Cuerpo completo C", slots: ["lunge", "chestC", "backH", "delSide", "legCurl", "bi", "tri", "abs"], extra: ["calf", "gluteI", "chestI"] },
  upperA: { name: "Tren superior A", slots: ["chestC", "backV", "backH", "delSide", "bi", "tri", "delC"], extra: ["chestI", "delRear", "abs"] },
  upperB: { name: "Tren superior B", slots: ["chestC", "backH", "delC", "backV", "bi", "tri", "chestI", "delRear"], extra: ["tri", "bi", "abs"] },
  lowerA: { name: "Tren inferior A", slots: ["quadC", "hingeC", "lunge", "legCurl", "calf", "abs", "gluteI"], extra: ["legExt", "calf"] },
  lowerB: { name: "Tren inferior B", slots: ["hingeC", "quadC", "legCurl", "legExt", "gluteI", "calf", "abs", "lunge"], extra: ["legCurl", "abs"] },
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
const SESSION_MINUTES = Object.keys(SESSION_DELTA).map(Number); // piso de cada rango: 45 = 45 a 60 min, 60 = 60 a 75, 75 = 75 a 90
const SESSION_RANGE = 15;

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

const LOWER_SLOTS = new Set(["quadC", "hingeC", "lunge", "legCurl", "legExt", "gluteI", "calf"]);
const MAIN_LEADS = new Set(["chestC", "backV", "delC", "quadC", "hingeC", "lunge"]);
// En cada día que entrena la zona: su ejercicio principal va primero y se suman ejercicios de volumen.
function applyPriorities(names, priorities, level) {
  let out = [...names];
  let added = 0;
  const extras = level === 1 ? 1 : 2;
  for (const z of [...priorities].reverse()) { // al revés: la primera prioridad queda primera
    const zone = ZONES[z];
    if (!out.some((n) => zone.slots.includes(n))) continue;
    const li = out.indexOf(zone.lead);
    if (li > 0 && MAIN_LEADS.has(zone.lead)) { out.splice(li, 1); out.unshift(zone.lead); } // un curl o una extensión no abren el día: primero va un principal
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
  // Al comer menos, la fuerza y la masa muscular se conservan entrenando con cargas medias (8-12), no con "muchas repeticiones livianas"
  bajar_grasa: { compound: { sets: 3, reps: "8-12", rest: 60 }, isolation: { sets: 3, reps: "12-15", rest: 45 } },
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

// Familias de movimiento: en un mismo día no se repite el mismo patrón pesado (dos peso muertos, dos sentadillas).
const familyOf = (name) => {
  if (/deadlift|good morning/i.test(name)) return "hinge";
  if (/squat|leg press|hack/i.test(name) && !/split|lunge/i.test(name)) return "squat";
  // Dos variantes del mismo movimiento en el mismo día no suman nada: el segundo ejercicio tiene que ser otra cosa
  if (/pushdown/i.test(name)) return "pushdown";
  if (/lateral raise/i.test(name) && !/rear/i.test(name)) return "lateral";
  if (/(bench|chest) press/i.test(name) && !/incline|decline/i.test(name)) return "flatpress";
  if (/incline.*(bench|chest) press/i.test(name)) return "inclinepress";
  if (/pulldown|pull-up|chin-up/i.test(name) && !/straight arm/i.test(name)) return "vpull";
  return null;
};

// Ejercicios que cargan el músculo en posición estirada (long muscle length). La evidencia reciente
// los favorece para hipertrofia, así que en ese enfoque pesan más al sortear entre candidatos.
const LENGTHENED = /incline (dumbbell |barbell |cable )?(press|curl|fly|flye)|romanian|stiff[- ]leg|good morning|overhead (triceps )?extension|french press|skull ?crusher|pull-?over|\bfly\b|\bflye\b|seated leg curl|lying leg curl|preacher curl|hack squat|bulgarian|split squat|front squat|full squat|cable crossover|\bdip\b|calf raise/i;
// Ejercicios raros, de rehabilitación o demasiado livianos para el objetivo: se evitan salvo que no haya otra opción.
const ODD = /\b(clock|cuban|stork|typewriter|archer|spider|dip cage|self assisted|inverse|isometric|bosu|behind (head|neck)|jefferson|zercher|bradford|sissy|pistol|bottoms|drag curl|on knees|kneeling push|wall|sphinx|stability ball|exercise ball|suspended|towel|poles?|modified|bench pull-?ups?|pelvic tilt|glute bridge|low glute|squat row|front raise|v\. 2)\b/i;
const FILLER = /\b(front raise|wrist|finger|forearm|neck|plate|kickback|side bend|twist|rotation|jack ?knife|v-up)\b/i;
const STAPLE_WEIGHT = { 0: 30, 1: 10, 2: 2, 3: 0.3 };
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
  // Los de toda la vida (press de banco, sentadilla, remo, jalón...) dominan la elección; lo raro, solo si no hay otra cosa
  if (e.role !== "cardio") w *= STAPLE_WEIGHT[staple(e.name)];
  return w;
}
const lengthenedBoost = (e, focus) => (focus === "hipertrofia" && LENGTHENED.test(e.name) ? 3.5 : 1);

// Candidatos para un slot, relajando criterios de a poco si no hay ninguno:
// 1) rol + patrón exactos, 2) solo rol, 3) cualquier ejercicio usable del músculo.
const BEGINNER_AVOID = /barbell (deadlift|good morning|front squat|stiff leg deadlift|straight leg deadlift)|trap bar deadlift|\b(pull-up|chin-up)\b|chest dip|barbell (rear )?lunge|barbell step-up|barbell standing military press/i;
const DUP_FAMILIES = new Set(["pushdown", "lateral", "flatpress", "inclinepress", "vpull"]);
function pickForSlot(pool, slot, ctx0) {
  const { effLevel, dayUsed, routineUsed, prevIds, rng, focus, minQ = 0, dayFamilies = new Set() } = ctx0;
  const ctx = ctx0;
  let base = pool.filter((e) => USABLE_ROLES.has(e.role) && e.level <= effLevel && slot.targets.includes(e.target) && (minQ <= 0 || qualityWeight(e, focus) >= minQ));
  // Algunos huecos piden un ejercicio concreto (ej.: elevaciones LATERALES para el deltoides medio, no frontales)
  if (slot.nameRe) {
    const exact = base.filter((e) => slot.nameRe.test(e.name) && !(slot.notRe && slot.notRe.test(e.name)));
    if (exact.length) base = exact;
  }
  const tiers = [
    (e) => (!slot.roles || slot.roles.includes(e.role)) && (!slot.patterns || slot.patterns.includes(e.pattern)),
    (e) => !slot.roles || slot.roles.includes(e.role),
    () => true,
  ];
  for (const tier of tiers) {
    let cands = base.filter(tier).filter((e) => !dayUsed.has(e.id) && !dayUsed.has(e.name));
    const fresh0 = cands.filter((e) => !dayFamilies.has(familyOf(e.name)));
    if (fresh0.length) cands = fresh0; // sin repetir familia pesada en el día, salvo que no quede otra
    else if (cands.length && cands.every((e) => DUP_FAMILIES.has(familyOf(e.name)))) { if (ctx) ctx.dupSkipped = true; continue; } // el mismo movimiento dos veces no suma: se refuerza el que ya está
    if (!cands.length) continue;
    // Canon de los programas de referentes: solo los 2 primeros grupos que existan en la sede (cambia de mes a mes sin salirse de lo clásico)
    if (slot.canon) {
      const ranked = cands.map((e) => ({ e, r: canonRank(slot.canon, e.name) })).filter((x) => x.r !== Infinity);
      if (ranked.length) {
        const best = Math.min(...ranked.map((x) => x.r));
        cands = ranked.filter((x) => x.r <= best + (slot.canon === "gluteI" ? 0 : 1)).map((x) => x.e); // glúteos: solo el primer grupo (hip thrust, puente, pull through)
      } else if (minQ > 0 && base.some((e) => canonRank(slot.canon, e.name) !== Infinity)) {
        continue; // para sumar ejercicios de relleno: si los clásicos ya se usaron hoy, mejor no sumar que meter una rareza
      }
    }
    // Quien recién empieza (menos de 6 meses): se evita lo más técnico y lo que más se lesiona si la técnica falla; se vuelve a eso cuando no queda otra
    if (effLevel === 1) {
      const easy = cands.filter((e) => !BEGINNER_AVOID.test(e.name));
      if (easy.length) cands = easy;
    }
    // Preferencia firme por los de toda la vida: lo demás solo entra si no queda ninguno de esos
    const proven = cands.filter((e) => e.role === "cardio" || staple(e.name) <= 2);
    if (proven.length) cands = proven;
    const fresh = cands.filter((e) => !routineUsed.has(e.id));
    // Preferimos no repetir, pero no a costa de calidad: si lo "nuevo" es una rareza y hay un buen ejercicio ya usado, se repite ese
    const good = (arr) => arr.some((e) => qualityWeight(e, focus) >= 1);
    const list = fresh.length && (good(fresh) || !good(cands)) ? fresh : cands;
    return weightedPick(
      list,
      (e) => equipmentWeight(e.equipment) * (e.level === effLevel ? 1.5 : 1) * (prevIds.has(e.id) ? 0.25 : 1) * (/hip thrust/i.test(e.name) ? 3 : 1) * lengthenedBoost(e, focus) * qualityWeight(e, focus),
      rng
    );
  }
  return null;
}


// Ajuste final con la evidencia (ver volume.js): ningún músculo grande por debajo del mínimo útil de series por semana
// ni por encima del techo. Sube o baja de a una serie, sin tocar qué ejercicios hay, y sin pasarse del tiempo pedido.
// Techo duro: por encima de ~31 series fraccionales por semana no se detecta ventaja alguna (Pelland 2024). El resto del rango objetivo
// es una guía: recortar series de más acortaría el día por debajo del tiempo que pidió el socio.
const HARD_CAP = 30;
function balanceWeeklyVolume({ days, poolById, focus, priorities, sessionMinutes, daysPerWeek }) {
  const priorityRegions = new Set(priorities.flatMap((z) => ZONE_REGIONS[z] ?? []));
  const exInfo = (x) => poolById.get(x.exerciseId);
  const touches = (x, region) => { const e = exInfo(x); return e && e.role !== "cardio" ? (contributions(e)[region] ?? 0) : 0; };
  const maxSets = (x) => (exInfo(x).role === "compound" ? 5 : 4);
  const minSets = (x) => (exInfo(x).role === "compound" ? 3 : 2);
  for (const region of REGIONS) {
    const { min, max } = rangeFor(focus, region, { priority: priorityRegions.has(region), daysPerWeek });
    for (let guard = 0; guard < 60; guard++) {
      const v = weeklyVolume(days, poolById)[region];
      if (v > Math.max(max, HARD_CAP)) {
        // baja una serie de donde más sobra (los ejercicios de aislamiento primero, los últimos del día primero)
        const cands = days.flatMap((d) => d.exercises.map((x, k) => ({ d, x, k }))).filter(({ x }) => touches(x, region) > 0 && x.sets > minSets(x));
        cands.sort((a, b) => touches(a.x, region) - touches(b.x, region) || (exInfo(a.x).role === "compound") - (exInfo(b.x).role === "compound") || b.x.sets - a.x.sets || b.k - a.k);
        if (!cands.length) break;
        cands[0].x.sets -= 1;
      } else if (v < min) {
        const cands = days.flatMap((d) => d.exercises.map((x, k) => ({ d, x, k }))).filter(({ d, x }) => touches(x, region) > 0 && x.sets < maxSets(x) && estimateMinutes(d.exercises.map((y) => (y === x ? { ...y, sets: y.sets + 1 } : y))) <= sessionMinutes + SESSION_RANGE + 5); // se puede pasar unos 5 min del tope del rango
        cands.sort((a, b) => touches(b.x, region) - touches(a.x, region) || (exInfo(b.x).role === "compound") - (exInfo(a.x).role === "compound") || a.x.sets - b.x.sets || a.k - b.k);
        if (!cands.length) break;
        cands[0].x.sets += 1;
      } else break;
    }
  }
}

/**
 * Genera las rutinas del ciclo.
 * @param pool        ejercicios disponibles en la sede (ver loadPool)
 * @param member      { id, level 1..3, daysPerWeek 2..6, focus }
 * @param cycleNumber 1, 2, 3... (cambia la semilla: cada mes salen ejercicios distintos)
 * @param prog        estado de progresión { setsBonus, extraPerDay, levelBoost, loadStep }
 * @param prevIds     Set con los ejercicios del ciclo anterior (se evita repetirlos)
 */
function generateOnce({ pool, member, cycleNumber = 1, prog = {}, prevIds = new Set(), attempt = 0 }) {
  const p = { ...DEFAULT_PROG, ...prog };
  const focus = FOCUSES.includes(member.focus) ? member.focus : "general";
  const split = splitFor({ daysPerWeek: member.daysPerWeek, focus, level: member.level });
  if (!split) throw new Error(`daysPerWeek inválido: ${member.daysPerWeek} (debe ser 2 a 6)`);
  if (![1, 2, 3].includes(member.level)) throw new Error(`level inválido: ${member.level} (debe ser 1, 2 o 3)`);
  const sessionMinutes = SESSION_MINUTES.includes(Number(member.sessionMinutes)) ? Number(member.sessionMinutes) : 60;

  const effLevel = Math.min(3, member.level + p.levelBoost);
  const rng = mulberry32(hashString(attempt ? `${member.id}:${cycleNumber}:${attempt}` : `${member.id}:${cycleNumber}`));
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
    const dayFamilies = new Set();
    const ctx = { effLevel, dayUsed, routineUsed, prevIds, rng, focus, dayFamilies };
    const fill = (slotName) => {
      ctx.dupSkipped = false;
      const ex = pickForSlot(pool, SLOTS[slotName], ctx);
      if (!ex) {
        if (ctx.dupSkipped) { // ya hay ese movimiento hoy: en vez de repetirlo, una serie más (como los 6 x 15 de laterales de los programas PPL)
          const fam = exercises.find((x) => DUP_FAMILIES.has(familyOf(poolById.get(x.exerciseId).name)) && SLOTS[slotName].targets.includes(poolById.get(x.exerciseId).target));
          if (fam && fam.sets < 5) fam.sets += 1;
          return true;
        }
        return false;
      }
      dayUsed.add(ex.id);
      dayUsed.add(ex.name); // el dataset repite nombres con distinto id: dos "lever chest press" no pueden ir el mismo día
      routineUsed.add(ex.id);
      if (familyOf(ex.name)) dayFamilies.add(familyOf(ex.name));
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
      const target = sessionMinutes + 7; // el rango es [sessionMinutes, sessionMinutes + 15]: se apunta al medio y se acepta ±7
      const cap = priorities.length ? MAX_PER_DAY_PRIORITY : MAX_PER_DAY;
      const extras = [...tpl.extra, ...tpl.slots];
      ctx.minQ = 3; // para completar tiempo solo entran ejercicios buenos (nunca una rareza de relleno)
      for (let k = 0; k < 12 && exercises.length < cap && estimateMinutes(exercises) < target - 7; k++) fill(extras[k % extras.length]);
      ctx.minQ = 0;
      // Si el día se pasa del tiempo pedido se recorta en este orden (la zona prioritaria es lo último que se toca):
      //  1) ejercicios repetidos de un músculo NO prioritario, 2) una serie menos en lo no prioritario (mínimo 2),
      //  3) exceso de la zona prioritaria (más de 3 ejercicios por músculo), 4) lo último del día.
      // Cada músculo conserva siempre al menos un ejercicio. Meta: nunca más de +10 minutos sobre lo pedido.
      const floor = focus === "fuerza" && target <= 45 ? 3 : 4;
      const tgt = (x) => poolById.get(x.exerciseId)?.target;
      const timesOf = (t) => exercises.filter((x) => tgt(x) === t).length;
      const dropAt = (idx) => { dayUsed.delete(exercises[idx].exerciseId); dayUsed.delete(poolById.get(exercises[idx].exerciseId)?.name); exercises.splice(idx, 1); };
      // con glúteos prioritarios, el hip thrust / puente del día no se recorta: es justamente lo que se pidió
      const keep = (x) => priorities.includes("gluteos") && poolById.get(x.exerciseId)?.pattern === "glute_isolation";
      const tooLong = () => estimateMinutes(exercises) - target > 7;
      while (exercises.length > floor && tooLong()) {
        let idx = -1;
        if (!priorities.length) idx = exercises.length - 1; // sin prioridades: simplemente lo último
        for (let k = exercises.length - 1; k > 0 && idx === -1; k--) if (!priorityTargets.has(tgt(exercises[k])) && timesOf(tgt(exercises[k])) > 1) idx = k;
        if (idx === -1) break;
        dropAt(idx);
      }
      for (let k = exercises.length - 1; k > 0 && tooLong(); k--) {
        if (!priorityTargets.has(tgt(exercises[k])) && exercises[k].sets > (poolById.get(exercises[k].exerciseId)?.role === "compound" ? 3 : 2)) exercises[k].sets -= 1; // los principales no bajan de 3 series: antes se saca un ejercicio
      }
      while (exercises.length > floor && tooLong()) {
        let idx = -1;
        for (let k = exercises.length - 1; k > 0 && idx === -1; k--) if (!keep(exercises[k]) && priorityTargets.has(tgt(exercises[k])) && timesOf(tgt(exercises[k])) > 2) idx = k;
        // un músculo que está solo una vez (ej.: el tríceps en un día de empuje) no se saca: antes se acepta pasarse unos minutos
        // Último recurso: se saca lo último del día, pero de un músculo que tenga más de un ejercicio (nunca el único: así el tríceps no desaparece de la semana)
        if (idx === -1) for (let k = exercises.length - 1; k > 0 && idx === -1; k--) if (!keep(exercises[k]) && timesOf(tgt(exercises[k])) > 1) idx = k;
        if (idx === -1) break;
        dropAt(idx);
      }
      exercises.forEach((x, k) => { x.position = k + 1; });
      // La progresión mensual suma (o saca) ejercicios por día encima de lo que entra en el tiempo pedido
      for (let k = 0; k < p.extraPerDay; k++) fill(extras[k % extras.length]);
      for (let k = 0; k > p.extraPerDay && exercises.length > 3; k--) { const last = exercises.pop(); dayUsed.delete(last.exerciseId); dayUsed.delete(poolById.get(last.exerciseId)?.name); }
    }
    // Bajar grasa: cierre con cardio
    if (focus === "bajar_grasa") fill("cardio");

    return { dayIndex: i + 1, label: `Día ${i + 1} – ${tpl.name}`, exercises, estMinutes: estimateMinutes(exercises) };
  });

  balanceWeeklyVolume({ days, poolById, focus, priorities, sessionMinutes, daysPerWeek: member.daysPerWeek });
  days.forEach((d) => { d.estMinutes = estimateMinutes(d.exercises); });

  const params = { level: member.level, daysPerWeek: member.daysPerWeek, focus, effLevel, cycleNumber, prog: p, sessionMinutes, priorities, prioritiesSource, gender: member.gender ?? null };

  // ---------- Reparación guiada por el evaluador ----------
  // Si la rutina tiene fallas bloqueantes (ver quality.js), se prueban movimientos chicos (una serie más o menos, sacar un
  // ejercicio, sumar uno) y se aplica el que más baja el costo; así hasta que no quede ninguna falla o no haya mejora.
  const evalNow = () => { days.forEach((d) => { d.estMinutes = estimateMinutes(d.exercises); }); return evaluateRoutine({ days, poolById, member, params }); };
  const renumber = (d) => d.exercises.forEach((x, k) => { x.position = k + 1; });
  const dayCap = priorities.length ? MAX_PER_DAY_PRIORITY : MAX_PER_DAY;
  let q = evalNow();
  let cost = qualityCost(q, days, sessionMinutes);
  for (let it = 0; it < 40 && !q.ok; it++) {
    let best = null;
    const consider = (di, newList, added) => {
      const old = days[di].exercises;
      days[di].exercises = newList;
      const c = qualityCost(evalNow(), days, sessionMinutes);
      days[di].exercises = old;
      if (c < cost - 1e-9 && (!best || c < best.c)) best = { di, newList, c, added };
    };
    days.forEach((d, di) => {
      d.exercises.forEach((x, k) => {
        const ex = poolById.get(x.exerciseId);
        const main = isMain(ex);
        if (ex.role === "cardio") return; // el cardio del final no se toca
        const maxS = main ? 5 : ex.role === "core" ? 3 : 4;
        const minS = main ? 3 : 2;
        if (x.sets < maxS) consider(di, d.exercises.map((y, j) => (j === k ? { ...y, sets: y.sets + 1 } : y)));
        if (x.sets > minS) consider(di, d.exercises.map((y, j) => (j === k ? { ...y, sets: y.sets - 1 } : y)));
        // se puede sacar un ejercicio aislado, o un principal si el día ya tiene otro del mismo movimiento y músculo
        const dup = main && d.exercises.some((y, j) => j !== k && isMain(poolById.get(y.exerciseId)) && poolById.get(y.exerciseId).pattern === ex.pattern && poolById.get(y.exerciseId).target === ex.target);
        if ((!main || dup) && ex.role !== "cardio" && d.exercises.length > 4 && k > 0) consider(di, d.exercises.filter((_, j) => j !== k));
      });
      if (d.exercises.length < dayCap) {
        const tplAll = [...TEMPLATES[split[di]].slots, ...TEMPLATES[split[di]].extra];
        const allowLower = tplAll.some((n) => LOWER_SLOTS.has(n));
        const allowUpper = tplAll.some((n) => !LOWER_SLOTS.has(n) && n !== "abs");
        for (const slotName of Object.keys(SLOTS)) {
          if (slotName === "cardio") continue;
          // un día de tren superior no recibe ejercicios de piernas (ni al revés)
          if (LOWER_SLOTS.has(slotName) ? !allowLower : slotName !== "abs" && !allowUpper) continue;
          const used = new Set(d.exercises.flatMap((y) => [y.exerciseId, poolById.get(y.exerciseId).name]));
          const fams = new Set(d.exercises.map((y) => familyOf(poolById.get(y.exerciseId).name)).filter(Boolean));
          const pick = pickForSlot(pool, SLOTS[slotName], { effLevel, dayUsed: used, routineUsed, prevIds, rng, focus, minQ: 3, dayFamilies: fams });
          if (!pick) continue;
          const s = schemeFor(pick, { focus, level: member.level, prog: p, isPriority: priorityTargets.has(pick.target), first: false });
          const item = { exerciseId: pick.id, position: 0, sets: s.sets, reps: s.reps, restSec: s.rest, note: s.note };
          // va después del último ejercicio del mismo músculo; si no hay, antes del abdomen del final
          let at = -1;
          d.exercises.forEach((y, j) => { if (poolById.get(y.exerciseId).target === pick.target) at = j; });
          if (at === -1) { at = d.exercises.length - 1; while (at >= 0 && ["core", "cardio"].includes(poolById.get(d.exercises[at].exerciseId).role)) at--; }
          if (at >= 0 && poolById.get(d.exercises[at].exerciseId).role === "cardio") at--;
          const list = [...d.exercises]; list.splice(at + 1, 0, item);
          consider(di, list, pick.id);
        }
      }
    });
    if (!best) break;
    days[best.di].exercises = best.newList;
    if (best.added) routineUsed.add(best.added);
    renumber(days[best.di]);
    q = evalNow();
    cost = qualityCost(q, days, sessionMinutes);
  }
  days.forEach((d) => { d.estMinutes = estimateMinutes(d.exercises); renumber(d); });

  return { days, warnings, params };
}

// Genera la rutina y la pasa por el evaluador de calidad (quality.js). Si tiene fallas bloqueantes, prueba con otras
// variantes (otra semilla) y se queda con la mejor; si ninguna queda limpia, la devuelve igual con sus fallas a la vista
// para que el profe la revise (quality.ok = false).
const MAX_ATTEMPTS = 12;
function generateRoutine(input) {
  const poolById = new Map(input.pool.map((e) => [e.id, e]));
  let best = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const gen = generateOnce({ ...input, attempt });
    const q = evaluateRoutine({ days: gen.days, poolById, member: input.member, params: gen.params });
    gen.quality = { ok: q.ok, score: q.score, blockers: q.blockers, warnings: q.warnings, attempts: attempt + 1 };
    if (!best || q.blockers.length < best.quality.blockers.length || (q.blockers.length === best.quality.blockers.length && q.score > best.quality.score)) best = gen;
    if (q.ok && q.score >= 90) break; // limpia y sin observaciones relevantes
  }
  best.quality.attempts = Math.min(MAX_ATTEMPTS, best.quality.attempts);
  return best;
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
  const ok = rows.filter((r) => !isBlocked(r.name, limitations) && (r.role === "cardio" || !isJunk(r.name, r.equipment)));
  return ok.map((r) => ({ ...r, secondary: r.secondary_muscles ?? [] }));
}

module.exports = {
  generateRoutine,
  generateOnce,
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
  SESSION_RANGE,
  estimateMinutes,
};
