// Evaluador de calidad de rutinas: se corre sobre CADA rutina generada, antes de publicarla.
//
// Devuelve { ok, score, blockers, warnings, stats }.
//  - blockers: fallas que un profesor corregiría a mano (la rutina no se publica si hay alguna y se puede evitar).
//  - warnings: cosas mejorables que no invalidan la rutina; bajan el puntaje.
// Cada regla tiene su sustento en un comentario. Los umbrales de volumen salen de volume.js (Schoenfeld 2017,
// Baz-Valle 2022, Pelland 2024, Iversen 2021); los de frecuencia, de Schoenfeld 2016.

const { staple } = require("./staples");
const { weeklyVolume, contributions, rangeFor, REGIONS, SMALL, ZONE_REGIONS } = require("./volume");

// Movimientos "principales" (multiarticulares) y los que cuentan para el equilibrio empuje/tirón
const MAIN_PATTERNS = new Set(["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull", "squat", "lunge", "hinge"]);
const PUSH = new Set(["horizontal_push", "vertical_push"]);
const PULL = new Set(["horizontal_pull", "vertical_pull", "rear_delt"]);
const QUAD = new Set(["squat", "lunge", "knee_extension"]);
const POST = new Set(["hinge", "knee_flexion", "glute_isolation"]);
const BIG = ["pecho", "espalda", "cuadriceps", "isquios"];

const isMain = (ex) => ex.role === "compound" && MAIN_PATTERNS.has(ex.pattern);
const repsRange = (r) => { const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(String(r ?? "")); return m ? [Number(m[1]), Number(m[2])] : null; };

function evaluateRoutine({ days, poolById, member, params }) {
  const blockers = [];
  let deficit = 0; // faltante continuo (series que faltan), para que la reparación tenga un camino de mejora paso a paso
  const warnings = [];
  const block = (code, msg) => blockers.push({ code, msg });
  const warn = (code, msg, penalty = 3) => warnings.push({ code, msg, penalty });

  const focus = params.focus;
  const sessionMinutes = params.sessionMinutes;
  const daysPerWeek = member.daysPerWeek;
  const priorities = params.priorities ?? [];
  const priorityRegions = new Set(priorities.flatMap((z) => ZONE_REGIONS[z] ?? []));
  const exOf = (x) => poolById.get(x.exerciseId);

  // 1) Estructura general
  if (days.length !== daysPerWeek) block("DIAS", `La rutina tiene ${days.length} días y el socio pidió ${daysPerWeek}.`);

  for (const d of days) {
    const list = d.exercises.map((x) => ({ x, ex: exOf(x) }));
    const nonCardio = list.filter(({ ex }) => ex && ex.role !== "cardio");
    const label = d.label;

    // 2) Tamaño del día: una sesión con 3 ejercicios no es una rutina; con más de 11 no entra en ningún horario
    const minEx = focus === "fuerza" ? 3 : sessionMinutes >= 60 ? 5 : 4; // fuerza: pocos ejercicios pesados es válido
    if (nonCardio.length < minEx) block("POCOS_EJ", `${label}: ${nonCardio.length} ejercicios; con ${sessionMinutes} min debería haber al menos ${minEx}.`);
    if (nonCardio.length > 11) block("MUCHOS_EJ", `${label}: ${nonCardio.length} ejercicios; es más de lo que entra en una sesión.`);

    // 3) Tiempo coherente con los minutos pedidos
    // La duración es un rango [piso, piso + 15]; pasarse unos minutos del tope es normal (75 puede llegar a 80)
    const hi = sessionMinutes + 15;
    if (d.estMinutes > hi + 8 || d.estMinutes < sessionMinutes - 10) block("TIEMPO", `${label}: dura unos ${d.estMinutes} min y el socio eligió de ${sessionMinutes} a ${hi}.`);
    else if (d.estMinutes > hi + 5 || d.estMinutes < sessionMinutes - 3) warn("TIEMPO_JUSTO", `${label}: ${d.estMinutes} min contra el rango de ${sessionMinutes} a ${hi}.`, 3);

    // 4) Sin repetidos ni dos veces el mismo movimiento
    const names = new Set();
    const patterns = {};
    for (const { ex } of nonCardio) {
      const n = ex.name.toLowerCase();
      if (names.has(n)) block("REPETIDO", `${label}: "${ex.name}" aparece dos veces el mismo día.`);
      names.add(n);
      if (isMain(ex)) patterns[`${ex.pattern}|${ex.target}`] = (patterns[`${ex.pattern}|${ex.target}`] ?? 0) + 1;
    }
    for (const [k, n] of Object.entries(patterns)) if (n > 2) warn("MISMO_MOV", `${label}: ${n} ejercicios principales del mismo movimiento (${k.split("|")[0]}).`, 4);

    // 5) El día arranca con un movimiento principal (con el músculo fresco y la fuerza disponible)
    const first = nonCardio[0]?.ex;
    if (first && !isMain(first) && first.role !== "core") block("PRIMERO_NO_PRINCIPAL", `${label}: arranca con "${first.name}", que es un ejercicio aislado; debería ir primero uno principal.`);
    if (!nonCardio.some(({ ex }) => isMain(ex))) block("SIN_PRINCIPAL", `${label}: no tiene ningún ejercicio principal (multiarticular).`);

    // 6) Orden: los aislados no van antes que los principales (salvo abdomen y lo que trabaja una zona distinta)
    const lastMain = nonCardio.reduce((a, { ex }, i) => (isMain(ex) ? i : a), -1);
    const isoBefore = nonCardio.slice(0, lastMain).filter(({ ex }) => !isMain(ex) && ex.role !== "core").length;
    if (isoBefore > 1) warn("ORDEN", `${label}: ${isoBefore} aislados antes del último ejercicio principal.`, 2);

    // 7) Intensidad por ejercicio: series y repeticiones acordes al enfoque
    for (const { x, ex } of nonCardio) {
      if (x.sets < 2) block("SERIES", `${label}: "${ex.name}" con ${x.sets} serie(s).`);
      if (x.sets > 6) block("SERIES", `${label}: "${ex.name}" con ${x.sets} series.`);
      if (isMain(ex) && x.sets < 3 && ex.role !== "core") block("PRINCIPAL_FLOJO", `${label}: el principal "${ex.name}" tiene solo ${x.sets} series.`);
      const rr = repsRange(x.reps);
      if (ex.role !== "core" && rr) {
        if (focus === "hipertrofia" && isMain(ex) && rr[0] > 10) warn("REPS_ALTAS", `${label}: "${ex.name}" a ${x.reps} reps; un principal de hipertrofia va a 6-12.`, 3);
        if (focus === "fuerza" && isMain(ex) && rr[1] > 8) warn("REPS_ALTAS", `${label}: "${ex.name}" a ${x.reps} reps; para fuerza el principal va a 3-6.`, 3);
        if (isMain(ex) && (x.restSec ?? 0) < 60) warn("DESCANSO", `${label}: "${ex.name}" con ${x.restSec}s de descanso, poco para un principal.`, 2);
      }
    }

    // 8) Series efectivas del día: ni sesión de relleno ni sesión imposible
    const hardSets = nonCardio.filter(({ ex }) => ex.role !== "core").reduce((a, { x }) => a + x.sets, 0);
    const minSets = Math.round(sessionMinutes * (focus === "hipertrofia" ? 0.25 : focus === "fuerza" ? 0.15 : 0.2));
    if (hardSets < minSets) block("POCA_INTENSIDAD", `${label}: ${hardSets} series de trabajo; para ${sessionMinutes} min se esperan al menos ${minSets}.`);
    if (hardSets > 34) block("DEMASIADO", `${label}: ${hardSets} series en un día; pasa el volumen que se recupera.`);

    // 9) Calidad de los ejercicios: nada raro ni poco común
    for (const { ex } of nonCardio) {
      if (ex.role !== "core" && staple(ex.name) >= 3) warn("POCO_COMUN", `${label}: "${ex.name}" es un ejercicio poco común.`, 3);
    }
  }

  // 10) Volumen semanal por región (la regla más importante para el resultado)
  const vol = weeklyVolume(days, poolById);
  const direct = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  const freq = Object.fromEntries(REGIONS.map((r) => [r, 0]));
  for (const d of days) {
    const hit = new Set();
    for (const x of d.exercises) {
      const ex = exOf(x);
      if (!ex || ex.role === "cardio") continue;
      const c = contributions(ex);
      for (const [r, w] of Object.entries(c)) { if (w >= 1) { direct[r] += x.sets; } if (w >= 0.5) hit.add(r); }
    }
    for (const r of hit) freq[r]++;
  }
  for (const r of REGIONS) {
    const prio = priorityRegions.has(r);
    const { min, max } = rangeFor(focus, r, { priority: prio, daysPerWeek });
    const v = vol[r];
    // Bajo el mínimo ideal pero cerca (hasta 20% menos, 10% en zonas prioritarias) es una observación; más abajo, una falla.
    // Con 2 días por semana el mínimo que se exige es el de Iversen 2021 (4 series): no hay tiempo físico para más.
    const floorMin = daysPerWeek <= 2 ? Math.min(min, 4) : min;
    if (BIG.includes(r) || prio) deficit += Math.max(0, floorMin - v);
    if (v < floorMin) {
      // con 45 a 60 min no entra el volumen ideal de todas las zonas: ahí la tolerancia es mayor
      const severe = (BIG.includes(r) || prio) && v < floorMin * (sessionMinutes <= 45 ? 0.65 : 0.8);
      (severe ? block : (c, m) => warn(c, m, 3))("VOLUMEN_BAJO", `${r}: ${v} series por semana; el mínimo útil para este perfil es ${floorMin}.`);
    }
    if (v > 36) block("VOLUMEN_ALTO", `${r}: ${v} series por semana; no hay ventaja detectable arriba de ~31 (Pelland 2024).`);
    else if (v > max + 4) warn("VOLUMEN_ALTO", `${r}: ${v} series por semana (techo recomendado ${max}).`, 3);
  }

  // 11) Brazos: en hipertrofia o con zona prioritaria deben tener trabajo directo (no solo el indirecto de los presses y jalones)
  for (const r of ["biceps", "triceps"]) {
    if (direct[r] === 0 && (focus === "hipertrofia" || priorityRegions.has(r))) {
      (priorityRegions.has(r) ? block : (c, m) => warn(c, m, 5))("SIN_DIRECTO", `${r}: ningún ejercicio directo en toda la semana.`);
    }
  }
  // Glúteos prioritarios: hace falta trabajo directo (hip thrust, puente, pull through), no solo el indirecto de la sentadilla y el peso muerto
  if (priorityRegions.has("gluteos") && daysPerWeek >= 3) deficit += Math.max(0, 6 - direct.gluteos);
  if (priorityRegions.has("gluteos") && daysPerWeek >= 3 && direct.gluteos < (sessionMinutes <= 45 || daysPerWeek <= 4 ? 4 : 6)) block("GLUTEO_DIRECTO", `gluteos (prioritario): ${direct.gluteos} series directas por semana; hace falta hip thrust, puente de glúteos o similar (al menos ${sessionMinutes <= 45 || daysPerWeek <= 4 ? 4 : 6}).`);
  for (const r of ["hombros"]) {
    if (focus === "hipertrofia" && direct[r] < 4) warn("SIN_DIRECTO", `${r}: menos de 4 series directas por semana.`, 4);
  }

  // 12) Frecuencia: cada músculo grande dos veces por semana (Schoenfeld 2016); las zonas prioritarias, sí o sí
  if (daysPerWeek >= 3) {
    for (const r of BIG) if (freq[r] < 2) (priorityRegions.has(r) || (focus === "hipertrofia" && daysPerWeek >= 4) ? block : (c, m) => warn(c, m, 4))("FRECUENCIA", `${r}: se entrena ${freq[r]} vez por semana; lo ideal es 2 o más.`);
    for (const r of priorityRegions) if (freq[r] < (r === "gemelos" ? 1 : 2)) block("FRECUENCIA", `${r} (prioritario): se entrena ${freq[r]} vez por semana.`);
  }

  // 13) Equilibrio: tirón vs empuje (hombros sanos) y cadena posterior vs cuádriceps (rodillas y espalda baja)
  let push = 0, pull = 0, quad = 0, post = 0;
  for (const d of days) for (const x of d.exercises) {
    const ex = exOf(x); if (!ex || ex.role === "cardio") continue;
    if (PUSH.has(ex.pattern)) push += x.sets;
    if (PULL.has(ex.pattern)) pull += x.sets;
    if (QUAD.has(ex.pattern)) quad += x.sets;
    if (POST.has(ex.pattern)) post += x.sets;
  }
  deficit += Math.max(0, push * 0.85 - pull);
  if (push && pull < push * 0.6) block("EMPUJE_TIRON", `Hay ${push} series de empuje y ${pull} de tirón por semana: demasiado empuje para los hombros.`);
  else if (push && pull < push * 0.85) warn("EMPUJE_TIRON", `Tirón (${pull}) algo bajo contra empuje (${push}).`, 3);
  if (quad && post < quad * 0.5) warn("CADENA_POSTERIOR", `Cadena posterior (${post}) muy baja contra cuádriceps (${quad}).`, 4);

  // 14) Tren inferior completo: si hay días de piernas, que haya cuádriceps + cadena posterior en la semana
  const nonCardioAll = days.flatMap((d) => d.exercises).map(exOf).filter((e) => e && e.role !== "cardio");
  if (daysPerWeek >= 2 && !nonCardioAll.some((e) => QUAD.has(e.pattern))) block("SIN_CUADS", "Ningún ejercicio de cuádriceps en toda la semana.");
  if (daysPerWeek >= 2 && !nonCardioAll.some((e) => e.pattern === "hinge" || e.pattern === "knee_flexion")) block("SIN_POSTERIOR", "Ningún ejercicio de femorales o bisagra de cadera en toda la semana.");

  const penalty = warnings.reduce((a, w) => a + w.penalty, 0);
  const score = Math.max(0, 100 - blockers.length * 15 - penalty);
  return { ok: blockers.length === 0, score, penalty, deficit, blockers, warnings: warnings.map(({ code, msg }) => ({ code, msg })), stats: { weeklyVolume: vol, directSets: direct, frequency: freq, push, pull, quad, post } };
}

// Costo para comparar variantes de una misma rutina: cada falla bloqueante pesa mucho, cada observación según su peso,
// y se castiga alejarse del tiempo pedido (más allá de 7 min de margen).
function qualityCost(q, days, sessionMinutes) {
  const time = days.reduce((a, d) => a + Math.max(0, sessionMinutes - d.estMinutes, d.estMinutes - sessionMinutes - 18) * 0.5, 0);
  return q.blockers.length * 20 + q.penalty + q.deficit * 0.7 + time;
}

module.exports = { qualityCost, evaluateRoutine, isMain, MAIN_PATTERNS };
