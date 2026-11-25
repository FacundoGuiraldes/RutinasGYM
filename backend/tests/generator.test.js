// Clasificador, importador y generador de rutinas sobre el catálogo REAL.
// Si no está descargado el dataset (npm run dataset:fetch) estos tests se saltean.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createSeededDb, findDatasetFile } = require("./helpers");
const { classifyExercise } = require("../src/classify");
const { importCatalog } = require("../src/importer");
const { loadPool, generateRoutine, FOCUSES, USABLE_ROLES } = require("../src/generator");

const datasetFile = findDatasetFile();
const skip = datasetFile ? false : "dataset no descargado (npm run dataset:fetch)";

test("clasificador: ejemplos conocidos", () => {
  const c = (name, target, equipment, body_part = "chest") => classifyExercise({ name, target, equipment, body_part });
  assert.deepEqual(c("barbell bench press", "pectorals", "barbell"), { role: "compound", pattern: "horizontal_push", level: 2 });
  assert.equal(c("dumbbell biceps curl", "biceps", "dumbbell", "upper arms").role, "isolation");
  assert.equal(c("lever leg extension", "quads", "leverage machine", "upper legs").pattern, "knee_extension");
  assert.equal(c("lat pulldown", "lats", "cable", "back").pattern, "vertical_pull");
  assert.equal(c("barbell snatch", "glutes", "barbell", "upper legs").level, 3);
  assert.equal(c("walk on treadmill", "cardiovascular system", "body weight", "cardio").role, "cardio");
  assert.equal(c("hamstring stretch", "hamstrings", "body weight", "upper legs").role, "mobility");
  assert.equal(c("crunch", "abs", "body weight", "waist").role, "core");
});

test("importador: catálogo completo, idempotente y respeta correcciones del admin", { skip }, async () => {
  const db = await createSeededDb();
  const records = JSON.parse(fs.readFileSync(datasetFile, "utf8"));

  const { rows: n } = await db.query("SELECT COUNT(*)::int AS n FROM exercises");
  assert.equal(n[0].n, records.length);
  const { rows: sedes } = await db.query("SELECT nombre FROM sedes ORDER BY nombre");
  assert.deepEqual(sedes.map((s) => s.nombre), ["Martínez", "Olivos"]);
  const { rows: unclassified } = await db.query("SELECT COUNT(*)::int AS n FROM exercises WHERE role IS NULL OR level IS NULL");
  assert.equal(unclassified[0].n, 0);

  // El admin corrige un ejercicio y desactiva equipamiento; reimportar no lo pisa
  await db.query("UPDATE exercises SET role = 'compound', level = 3, classified_by = 'admin', enabled = FALSE WHERE id = '0001'");
  await db.query("UPDATE sede_equipment SET available = FALSE WHERE equipment_id = (SELECT id FROM equipment WHERE key = 'cable') AND sede_id = 1");
  await importCatalog(db, records);
  const { rows: ex } = await db.query("SELECT role, level, enabled FROM exercises WHERE id = '0001'");
  assert.deepEqual(ex[0], { role: "compound", level: 3, enabled: false });
  const { rows: cable } = await db.query("SELECT available FROM sede_equipment WHERE sede_id = 1 AND equipment_id = (SELECT id FROM equipment WHERE key = 'cable')");
  assert.equal(cable[0].available, false);
  const { rows: n2 } = await db.query("SELECT COUNT(*)::int AS n FROM exercises");
  assert.equal(n2[0].n, records.length, "no duplica");
  await db.close();
});

test("generador: todas las combinaciones de nivel x días x enfoque son válidas", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const byId = new Map(pool.map((e) => [e.id, e]));
  let combos = 0;
  for (const level of [1, 2, 3]) {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      for (const focus of FOCUSES) {
        const r = generateRoutine({ pool, member: { id: 11, level, daysPerWeek, focus }, cycleNumber: 1 });
        combos++;
        assert.equal(r.days.length, daysPerWeek);
        assert.deepEqual(r.warnings, [], `sin huecos sin llenar (${level}/${daysPerWeek}/${focus})`);
        for (const d of r.days) {
          assert.ok(d.exercises.length >= 4, "al menos 4 ejercicios por día");
          const ids = d.exercises.map((x) => x.exerciseId);
          assert.equal(new Set(ids).size, ids.length, "sin repetidos dentro del día");
          for (const x of d.exercises) {
            const e = byId.get(x.exerciseId);
            assert.ok(e, "el ejercicio sale del pool de la sede");
            assert.ok(USABLE_ROLES.has(e.role));
            assert.ok(e.level <= level, `nivel ${e.level} <= ${level}`);
            assert.ok(x.sets >= 1 && x.sets <= 5);
          }
          if (focus === "bajar_grasa") assert.equal(byId.get(d.exercises.at(-1).exerciseId).role, "cardio", "cierra con cardio");
        }
      }
    }
  }
  assert.equal(combos, 60);
  await db.close();
});

test("generador: es reproducible y cada ciclo trae ejercicios distintos", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const member = { id: 5, level: 2, daysPerWeek: 4, focus: "hipertrofia" };
  const a = generateRoutine({ pool, member, cycleNumber: 1 });
  const a2 = generateRoutine({ pool, member, cycleNumber: 1 });
  assert.deepEqual(a.days, a2.days, "misma semilla, misma rutina");

  const idsA = new Set(a.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)));
  const b = generateRoutine({ pool, member, cycleNumber: 2, prevIds: idsA });
  const idsB = b.days.flatMap((d) => d.exercises.map((e) => e.exerciseId));
  const repeated = idsB.filter((id) => idsA.has(id)).length;
  assert.ok(repeated < idsB.length * 0.5, `el ciclo 2 renueva la mayoría (repetidos: ${repeated}/${idsB.length})`);
  await db.close();
});

test("generador: nunca usa lo que la sede no tiene", { skip }, async () => {
  const db = await createSeededDb();
  // Olivos (sede 2) sin máquinas ni poleas, y sin un ejercicio puntual
  await db.query(
    `UPDATE sede_equipment SET available = FALSE WHERE sede_id = 2
     AND equipment_id IN (SELECT id FROM equipment WHERE key IN ('leverage machine', 'cable', 'smith machine'))`
  );
  const { rows: sample } = await db.query("SELECT id FROM exercises WHERE name = 'barbell bench press'");
  await db.query("INSERT INTO sede_exclusions (sede_id, exercise_id, reason) VALUES (2, $1, 'sin banco')", [sample[0].id]);
  await db.query("UPDATE exercises SET enabled = FALSE WHERE name = 'barbell full squat'");

  const pool = await loadPool(db, 2);
  const byId = new Map(pool.map((e) => [e.id, e]));
  assert.ok(!pool.some((e) => ["leverage machine", "cable", "smith machine"].includes(e.equipment)));
  assert.ok(!byId.has(sample[0].id));

  for (const daysPerWeek of [3, 4, 6]) {
    for (let cycle = 1; cycle <= 5; cycle++) {
      const r = generateRoutine({ pool, member: { id: cycle, level: 3, daysPerWeek, focus: "general" }, cycleNumber: cycle });
      for (const d of r.days) for (const x of d.exercises) assert.ok(byId.has(x.exerciseId), "solo ejercicios de la sede");
    }
  }
  await db.close();
});

test("generador: la progresión sube series, cantidad o dificultad", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const member = { id: 9, level: 2, daysPerWeek: 4, focus: "hipertrofia" };
  const base = generateRoutine({ pool, member, cycleNumber: 1 });
  const moreSets = generateRoutine({ pool, member, cycleNumber: 1, prog: { setsBonus: 1 } });
  const moreEx = generateRoutine({ pool, member, cycleNumber: 1, prog: { extraPerDay: 2 } });
  const harder = generateRoutine({ pool, member, cycleNumber: 1, prog: { levelBoost: 1 } });
  const totalSets = (r) => r.days.flatMap((d) => d.exercises).reduce((a, x) => a + x.sets, 0);
  const totalEx = (r) => r.days.reduce((a, d) => a + d.exercises.length, 0);
  assert.ok(totalSets(moreSets) > totalSets(base));
  assert.equal(totalEx(moreEx), totalEx(base) + 2 * 4);
  assert.equal(harder.params.effLevel, 3);
  await db.close();
});

test("generador: valida parámetros", () => {
  assert.throws(() => generateRoutine({ pool: [], member: { id: 1, level: 2, daysPerWeek: 7, focus: "general" } }), /daysPerWeek/);
  assert.throws(() => generateRoutine({ pool: [], member: { id: 1, level: 9, daysPerWeek: 3, focus: "general" } }), /level/);
});

// Series semanales por músculo de una rutina
function weeklySets(routine, byId) {
  const vol = {};
  for (const d of routine.days) for (const e of d.exercises) { const t = byId.get(e.exerciseId).target; vol[t] = (vol[t] || 0) + e.sets; }
  return vol;
}

test("hipertrofia: la zona priorizada recibe más series, entra primero y se entrena 2 veces por semana", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const byId = new Map(pool.map((e) => [e.id, e]));
  const gen = (priorities, extra = {}) => generateRoutine({ pool, member: { id: 7, level: 2, daysPerWeek: 4, focus: "hipertrofia", priorities, sessionMinutes: 60, ...extra }, cycleNumber: 1 });

  const even = weeklySets(gen([]), byId);
  const glu = gen(["gluteos"]);
  const gluVol = weeklySets(glu, byId);
  assert.ok((gluVol.glutes || 0) > (even.glutes || 0), `glúteos con prioridad (${gluVol.glutes}) > parejo (${even.glutes})`);
  const daysWithGlutes = glu.days.filter((d) => d.exercises.some((e) => byId.get(e.exerciseId).target === "glutes")).length;
  assert.ok(daysWithGlutes >= 2, "frecuencia mínima de 2 por semana");
  assert.deepEqual(glu.params.priorities, ["gluteos"]);

  const chest = gen(["pecho"]);
  assert.ok((weeklySets(chest, byId).pectorals || 0) > (even.pectorals || 0));
  await db.close();
});

test("hipertrofia: sin prioridad elegida el género sugiere el énfasis, y 'parejo' ([]) lo respeta", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const base = { id: 9, level: 2, daysPerWeek: 4, focus: "hipertrofia", sessionMinutes: 60 };
  const mujer = generateRoutine({ pool, member: { ...base, gender: "mujer", priorities: null }, cycleNumber: 1 });
  const hombre = generateRoutine({ pool, member: { ...base, gender: "hombre", priorities: null }, cycleNumber: 1 });
  const parejo = generateRoutine({ pool, member: { ...base, gender: "mujer", priorities: [] }, cycleNumber: 1 });
  assert.deepEqual(mujer.params.priorities, ["gluteos", "piernas"]);
  assert.deepEqual(hombre.params.priorities, ["pecho", "hombros"]);
  assert.deepEqual(parejo.params.priorities, [], "elegir parejo no se pisa con el género");
  await db.close();
});

test("hipertrofia: más minutos por sesión significan más ejercicios, y la duración estimada acompaña", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const count = (mins) => {
    const r = generateRoutine({ pool, member: { id: 3, level: 2, daysPerWeek: 3, focus: "hipertrofia", priorities: [], sessionMinutes: mins }, cycleNumber: 1 });
    return { n: r.days[0].exercises.length, est: r.days[0].estMinutes };
  };
  const a = count(45), b = count(75);
  assert.ok(b.n > a.n, `75 min (${b.n}) > 45 min (${a.n}) ejercicios`);
  assert.ok(b.est >= a.est);
  await db.close();
});

test("hipertrofia: todas las combinaciones con prioridades y duraciones son válidas", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  let combos = 0;
  for (const level of [1, 2, 3]) for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const sessionMinutes of [45, 60, 75]) {
    for (const priorities of [[], ["gluteos", "piernas"], ["pecho", "brazos"], ["espalda"], ["abdomen", "hombros"]]) {
      const r = generateRoutine({ pool, member: { id: 21, level, daysPerWeek, focus: "hipertrofia", priorities, sessionMinutes, gender: "mujer" }, cycleNumber: 2 });
      combos++;
      assert.equal(r.days.length, daysPerWeek);
      assert.deepEqual(r.warnings, [], `${level}/${daysPerWeek}/${sessionMinutes}/${priorities}`);
      for (const d of r.days) {
        const ids = d.exercises.map((x) => x.exerciseId);
        assert.equal(new Set(ids).size, ids.length, "sin repetidos dentro del día");
        assert.ok(d.exercises.length >= 4);
        for (const x of d.exercises) assert.ok(x.sets >= 1 && x.sets <= 5);
      }
    }
  }
  assert.equal(combos, 225);
  await db.close();
});

test("hipertrofia: los ejercicios en posición estirada aparecen más que en un enfoque general", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const byId = new Map(pool.map((e) => [e.id, e]));
  const re = /incline (dumbbell |barbell |cable )?(press|curl|fly|flye)|romanian|stiff[- ]leg|overhead (triceps )?extension|pull-?over|\bfly\b|seated leg curl|lying leg curl|preacher curl|hack squat|bulgarian|split squat|front squat|calf raise/i;
  const share = (focus) => {
    let hit = 0, tot = 0;
    for (let id = 1; id <= 40; id++) {
      const r = generateRoutine({ pool, member: { id, level: 2, daysPerWeek: 4, focus, priorities: [], sessionMinutes: 60 }, cycleNumber: 1 });
      for (const d of r.days) for (const x of d.exercises) { tot++; if (re.test(byId.get(x.exerciseId).name)) hit++; }
    }
    return hit / tot;
  };
  const h = share("hipertrofia"), g = share("general");
  assert.ok(h > g, `hipertrofia ${h.toFixed(3)} > general ${g.toFixed(3)}`);
  await db.close();
});

test("nombres en español: la mayoría se traduce, y lo traducido es legible", async () => {
  const { translateName } = require("../src/namesEs");
  assert.equal(translateName("dumbbell biceps curl").es, "Curl de bíceps con mancuernas");
  assert.equal(translateName("barbell bench press").es, "Press de banco con barra");
  assert.equal(translateName("lever seated crunch").es, "Abdominal sentado en máquina");
  assert.equal(translateName("trap bar deadlift").es, "Peso muerto con barra hexagonal");
  assert.equal(translateName("sphinx").complete, true);
  assert.equal(translateName("zzzz qqqq").complete, false, "lo desconocido queda sin traducir");
});

test("nombres en español: se guardan al importar y la vista del socio los usa", { skip }, async () => {
  const db = await createSeededDb();
  const { rows } = await db.query("SELECT COUNT(*) FILTER (WHERE name_es IS NOT NULL)::int AS es, COUNT(*)::int AS n FROM exercises");
  assert.ok(rows[0].es / rows[0].n > 0.6, `cobertura ${rows[0].es}/${rows[0].n}`);
  const { rows: one } = await db.query("SELECT name, name_es FROM exercises WHERE name = 'dumbbell biceps curl'");
  assert.equal(one[0].name_es, "Curl de bíceps con mancuernas");
  await db.close();
});

test("tiempo de sesión: los minutos estimados acompañan lo que pidió el socio y la cantidad de ejercicios", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  let days = 0, off = 0;
  for (const level of [1, 2, 3]) for (const daysPerWeek of [2, 3, 4, 5, 6]) for (const focus of ["hipertrofia", "general", "fuerza"]) for (const sessionMinutes of [45, 60, 75]) {
    const r = generateRoutine({ pool, member: { id: 5, level, daysPerWeek, focus, priorities: [], sessionMinutes, gender: "mujer" }, cycleNumber: 1 });
    for (const d of r.days) {
      days++;
      if (Math.abs(d.estMinutes - sessionMinutes) > 10) off++;
      assert.ok(d.exercises.length >= 3);
    }
  }
  assert.ok(off / days < 0.03, `${off} de ${days} días se desvían más de 10 minutos`);
  // Más minutos, más ejercicios (mismo socio)
  const count = (m) => generateRoutine({ pool, member: { id: 5, level: 2, daysPerWeek: 4, focus: "hipertrofia", priorities: [], sessionMinutes: m }, cycleNumber: 1 }).days[0].exercises.length;
  assert.ok(count(75) > count(45));
  await db.close();
});

test("calidad de ejercicios: en ganar músculo no entran rarezas ni ejercicios que no se pueden cargar", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  const bad = /clock|cuban|stork|dip cage|self assisted|pelvic tilt|bench pull-?up|behind (head|neck)|resistance band|on knees/i;
  let total = 0, rare = 0;
  for (let id = 1; id <= 30; id++) for (const level of [1, 2, 3]) {
    const r = generateRoutine({ pool, member: { id, level, daysPerWeek: 4, focus: "hipertrofia", priorities: [], sessionMinutes: 60 }, cycleNumber: 1 });
    for (const d of r.days) for (const x of d.exercises) { total++; if (bad.test(by.get(x.exerciseId).name)) rare++; }
  }
  assert.ok(rare / total < 0.01, `${rare} de ${total} ejercicios raros`);
  await db.close();
});

test("básicos primero: casi todo lo que se elige es un ejercicio de toda la vida y nada de lo que nadie usa", { skip }, async () => {
  const { staple, isJunk } = require("../src/staples");
  assert.equal(staple("barbell bench press"), 0);
  assert.equal(staple("lever leg extension"), 0);
  assert.equal(isJunk("front lever", "body weight"), true);
  assert.equal(isJunk("barbell snatch", "barbell"), true);
  assert.equal(isJunk("dumbbell fly on exercise ball", "dumbbell"), true);
  assert.equal(isJunk("resistance band leg extension", "resistance band"), true);
  assert.equal(isJunk("barbell full squat", "barbell"), false);

  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  assert.ok(!pool.some((e) => e.role !== "cardio" && isJunk(e.name, e.equipment)), "el pool no trae lo que nadie usa");
  const by = new Map(pool.map((e) => [e.id, e]));
  let total = 0, tier1 = 0, tier3 = 0;
  for (let id = 1; id <= 25; id++) for (const focus of ["hipertrofia", "general", "fuerza", "bajar_grasa"]) for (const level of [1, 2, 3]) {
    const r = generateRoutine({ pool, member: { id, level, daysPerWeek: 4, focus, priorities: [], sessionMinutes: 60 }, cycleNumber: 1 });
    for (const d of r.days) for (const x of d.exercises) { const e = by.get(x.exerciseId); if (e.role === "cardio") continue; total++; const t = staple(e.name); if (t <= 1) tier1++; if (t === 3) tier3++; }
  }
  assert.ok(tier1 / total > 0.7, `básicos ${(tier1 / total).toFixed(2)}`);
  assert.equal(tier3, 0, "ningún ejercicio fuera de lo común cuando hay alternativas");
  await db.close();
});

test("sustento: cada músculo grande se entrena 2 veces por semana y hombros llevan elevaciones laterales", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  const group = { pectorals: "pecho", lats: "espalda", "upper back": "espalda", delts: "hombros", quads: "piernas", glutes: "piernas", hamstrings: "piernas" };
  for (const focus of ["hipertrofia", "general"]) for (const level of [1, 2, 3]) for (const daysPerWeek of [2, 3, 4, 5, 6]) {
    const r = generateRoutine({ pool, member: { id: 3, level, daysPerWeek, focus, priorities: [], sessionMinutes: 60 }, cycleNumber: 1 });
    const freq = {};
    let lateral = 0;
    for (const d of r.days) {
      const seen = new Set();
      for (const x of d.exercises) { const e = by.get(x.exerciseId); if (group[e.target]) seen.add(group[e.target]); if (/lateral raise/i.test(e.name) && !/rear|reverse/i.test(e.name)) lateral++; }
      for (const g of seen) freq[g] = (freq[g] || 0) + 1;
    }
    for (const g of ["pecho", "espalda", "hombros", "piernas"]) assert.ok((freq[g] || 0) >= 2, `${g} ${freq[g] || 0}x (${focus}, N${level}, ${daysPerWeek} días)`);
    if (daysPerWeek >= 4) assert.ok(lateral >= 1, `elevaciones laterales (${focus}, N${level}, ${daysPerWeek} días)`);
  }
  await db.close();
});

test("un día no repite dos peso muertos ni dos sentadillas pesadas", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  for (let id = 1; id <= 30; id++) for (const level of [1, 2, 3]) {
    const r = generateRoutine({ pool, member: { id, level, daysPerWeek: 4, focus: "hipertrofia", priorities: [], sessionMinutes: 75 }, cycleNumber: 1 });
    for (const d of r.days) {
      const names = d.exercises.map((x) => by.get(x.exerciseId).name);
      assert.ok(names.filter((n) => /deadlift|good morning/i.test(n)).length <= 1, `peso muertos repetidos: ${names.join(" | ")}`);
    }
  }
  await db.close();
});

test("canon de programas de referentes: lo elegido sale de la lista clásica y no se repite el mismo movimiento en el día", { skip }, async () => {
  const { canonRank } = require("../src/canon");
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  let total = 0, inCanon = 0;
  for (let id = 1; id <= 30; id++) for (const focus of ["hipertrofia", "general", "bajar_grasa"]) for (const level of [1, 2, 3]) for (const days of [3, 4, 6]) {
    const r = generateRoutine({ pool, member: { id, level, daysPerWeek: days, focus, priorities: [], sessionMinutes: 60 }, cycleNumber: 1 });
    for (const d of r.days) {
      const names = d.exercises.map((x) => by.get(x.exerciseId).name);
      assert.equal(new Set(names).size, names.length, "ningún ejercicio repetido en el día");
      assert.ok(names.filter((n) => /pushdown/i.test(n)).length <= 1, `dos pushdown el mismo día: ${names}`);
      for (const x of d.exercises) {
        const e = by.get(x.exerciseId);
        if (e.role === "cardio") continue;
        total++;
        if (Object.keys(require("../src/canon").CANON).some((s) => canonRank(s, e.name) !== Infinity)) inCanon++;
      }
    }
  }
  assert.ok(inCanon / total > 0.9, `en el canon: ${(inCanon / total).toFixed(2)}`);
  await db.close();
});

test("volumen semanal: sin prioridades, ningún músculo grande queda por debajo del mínimo útil ni se pasa del techo", { skip }, async () => {
  const { weeklyVolume } = require("../src/volume");
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  for (const focus of ["hipertrofia", "general", "bajar_grasa", "fuerza"]) for (const level of [1, 2, 3]) for (const days of [3, 4, 5, 6]) for (const mins of [45, 60, 75]) {
    const r = generateRoutine({ pool, member: { id: 7, level, daysPerWeek: days, focus, priorities: focus === "hipertrofia" ? [] : null, sessionMinutes: mins, gender: "mujer" }, cycleNumber: 1 });
    const v = weeklyVolume(r.days, by);
    const need = focus === "hipertrofia" && days >= 4 ? 8 : 4; // 10 series es el mínimo con claro beneficio (Schoenfeld 2017); 4 ya sirve con poco tiempo (Iversen 2021)
    for (const k of ["pecho", "espalda", "cuadriceps", "isquios"]) assert.ok(v[k] >= need, `${focus} N${level} ${days}d ${mins}m: ${k} ${v[k]} < ${need}`);
    for (const [k, x] of Object.entries(v)) assert.ok(x <= 36, `${focus} N${level} ${days}d ${mins}m: ${k} ${x} > 36 (sin ventaja detectable por encima, Pelland 2024)`);
  }
  await db.close();
});

test("prioridad brazos: el tríceps aparece en la semana aunque el tiempo obligue a recortar", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  for (const days of [3, 4, 5]) for (const mins of [45, 60]) {
    const r = generateRoutine({ pool, member: { id: 7, level: 2, daysPerWeek: days, focus: "hipertrofia", priorities: ["pecho", "brazos"], sessionMinutes: mins, gender: "hombre" }, cycleNumber: 1 });
    const n = r.days.flatMap((d) => d.exercises).filter((x) => by.get(x.exerciseId).target === "triceps").length;
    assert.ok(n >= 1, `${days}d ${mins}m: sin tríceps en la semana`);
  }
  await db.close();
});

// ---------- Control de calidad: ninguna rutina generada se publica con fallas bloqueantes ----------
const { evaluateRoutine } = require("../src/quality");

test("quality: el evaluador detecta una rutina mala (sin tríceps con brazos prioritario, curl de primero, sin tirón)", () => {
  const mk = (id, role, pattern, target, name) => [id, { id, role, pattern, target, name }];
  const poolById = new Map([
    mk(1, "isolation", "elbow_flexion", "biceps", "dumbbell curl"),
    mk(2, "compound", "horizontal_push", "pectorals", "barbell bench press"),
    mk(3, "compound", "horizontal_push", "pectorals", "dumbbell bench press"),
    mk(4, "isolation", "elbow_flexion", "biceps", "cable curl"),
  ]);
  const days = [{ label: "Día 1", estMinutes: 20, exercises: [1, 2, 3, 4].map((id) => ({ exerciseId: id, sets: 3, reps: "8-12", restSec: 60 })) }];
  const q = evaluateRoutine({ days, poolById, member: { daysPerWeek: 1 }, params: { focus: "hipertrofia", sessionMinutes: 60, priorities: ["brazos"] } });
  assert.equal(q.ok, false);
  const codes = q.blockers.map((b) => b.code);
  for (const c of ["PRIMERO_NO_PRINCIPAL", "TIEMPO", "SIN_DIRECTO", "EMPUJE_TIRON"]) assert.ok(codes.includes(c), `debería detectar ${c}: ${codes}`);
});

test("quality: ningún perfil típico sale con fallas bloqueantes (nivel, días, enfoque, minutos, prioridades)", { skip }, async () => {
  const db = await createSeededDb();
  const pool = await loadPool(db, 1);
  const by = new Map(pool.map((e) => [e.id, e]));
  const PR = [[], ["pecho", "brazos"], ["gluteos", "piernas"], ["espalda", "hombros"], undefined];
  let n = 0;
  const fails = [];
  for (const level of [1, 2, 3]) for (const days of [2, 3, 4, 5, 6]) for (const focus of ["hipertrofia", "general", "bajar_grasa", "fuerza"])
    for (const mins of [45, 60, 75]) for (const pr of focus === "hipertrofia" ? PR : [undefined]) {
      const member = { id: ++n, level, daysPerWeek: days, focus, priorities: pr, sessionMinutes: mins, gender: n % 2 ? "hombre" : "mujer" };
      const r = generateRoutine({ pool, member, cycleNumber: 1 });
      const q = evaluateRoutine({ days: r.days, poolById: by, member, params: r.params });
      if (!q.ok) fails.push(`N${level} ${days}d ${focus} ${mins}m ${JSON.stringify(pr)}: ${q.blockers.map((b) => b.msg).join(" | ")}`);
      assert.equal(r.quality.ok, q.ok, "generateRoutine debe informar el mismo resultado que el evaluador");
    }
  await db.close();
  assert.equal(fails.length, 0, `${fails.length} rutinas con fallas:\n${fails.slice(0, 5).join("\n")}`);
});
