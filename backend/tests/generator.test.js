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
          assert.ok(d.exercises.length >= 5, "al menos 5 ejercicios por día");
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
