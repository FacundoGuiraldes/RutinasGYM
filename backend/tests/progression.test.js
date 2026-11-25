// Progresión mensual: decisiones, palancas y cierre de ciclos (con el catálogo real).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSeededDb, findDatasetFile, addMember } = require("./helpers");
const { decide, nextProg, closeCycle, closeDueCycles, measureAdherence } = require("../src/progression");
const { createRoutine, getActiveRoutine, CYCLE_DAYS } = require("../src/routines");
const { addDays, localDate } = require("../src/util");

const skip = findDatasetFile() ? false : "dataset no descargado (npm run dataset:fetch)";

test("decide: umbrales 85 / 60", () => {
  assert.equal(decide(100), "PROGRESS");
  assert.equal(decide(85), "PROGRESS");
  assert.equal(decide(84.9), "MAINTAIN");
  assert.equal(decide(60), "MAINTAIN");
  assert.equal(decide(59.9), "SIMPLIFY");
  assert.equal(decide(0), "SIMPLIFY");
});

test("nextProg: PROGRESS rota la palanca y respeta los topes", () => {
  const p1 = nextProg({}, "PROGRESS", { cycleNumber: 1, memberLevel: 2 });
  assert.equal(p1.prog.setsBonus, 1);
  assert.equal(p1.prog.loadStep, 1);
  const p2 = nextProg(p1.prog, "PROGRESS", { cycleNumber: 2, memberLevel: 2 });
  assert.equal(p2.prog.extraPerDay, 1, "el ciclo 2 sube la cantidad de ejercicios");
  const p3 = nextProg(p2.prog, "PROGRESS", { cycleNumber: 3, memberLevel: 2 });
  assert.equal(p3.prog.levelBoost, 1, "el ciclo 3 sube la dificultad");

  // Un avanzado (nivel 3) no puede subir más la dificultad: pasa a otra palanca
  const adv = nextProg({}, "PROGRESS", { cycleNumber: 3, memberLevel: 3 });
  assert.equal(adv.prog.levelBoost, 0);
  assert.equal(adv.prog.setsBonus + adv.prog.extraPerDay, 1);

  // Todo al tope: solo queda subir la carga
  const maxed = nextProg({ setsBonus: 2, extraPerDay: 2, levelBoost: 1, loadStep: 2 }, "PROGRESS", { cycleNumber: 1, memberLevel: 1 });
  assert.deepEqual({ ...maxed.prog }, { setsBonus: 2, extraPerDay: 2, levelBoost: 1, loadStep: 3 });
  assert.match(maxed.changes[0], /máximo/);
});

test("nextProg: SIMPLIFY baja de a un escalón y MAINTAIN no cambia nada", () => {
  const s1 = nextProg({ extraPerDay: 1, setsBonus: 1, loadStep: 2 }, "SIMPLIFY", { cycleNumber: 2, memberLevel: 2 });
  assert.equal(s1.prog.extraPerDay, 0);
  assert.equal(s1.prog.setsBonus, 1);
  assert.equal(s1.prog.loadStep, 1);
  const floor = nextProg({ setsBonus: -1 }, "SIMPLIFY", { cycleNumber: 2, memberLevel: 2 });
  assert.equal(floor.prog.setsBonus, -1, "no baja de -1");
  const m = nextProg({ setsBonus: 1 }, "MAINTAIN", { cycleNumber: 2, memberLevel: 2 });
  assert.equal(m.prog.setsBonus, 1);
});

// Crea un socio con rutina activa y le carga sesiones
async function memberWithRoutine(db, opts = {}) {
  const m = await addMember(db, { days: 3, level: 2, focus: "hipertrofia", ...opts });
  const { routineId } = await createRoutine(db, { ...m, sede_nombre: "Olivos" }, { cycleNumber: 1, startsOn: addDays(localDate(), -CYCLE_DAYS) });
  const { rows: days } = await db.query("SELECT id FROM routine_days WHERE routine_id = $1 ORDER BY day_index", [routineId]);
  return { m, routineId, days };
}

async function addSessions(db, m, days, { completed, partialExercises = 0 }) {
  let n = 0;
  for (let i = 0; i < completed; i++) {
    n++;
    await db.query(
      "INSERT INTO sessions (routine_day_id, member_id, session_date, completed_at) VALUES ($1, $2, $3::date, now())",
      [days[i % days.length].id, m.id, addDays(localDate(), -n)]
    );
  }
  if (partialExercises) {
    n++;
    const { rows } = await db.query("INSERT INTO sessions (routine_day_id, member_id, session_date) VALUES ($1, $2, $3::date) RETURNING id", [days[0].id, m.id, addDays(localDate(), -n - 20)]);
    const { rows: exs } = await db.query("SELECT id FROM routine_exercises WHERE day_id = $1 ORDER BY position LIMIT $2", [days[0].id, partialExercises]);
    for (const e of exs) await db.query("INSERT INTO session_exercises (session_id, routine_exercise_id) VALUES ($1, $2)", [rows[0].id, e.id]);
  }
}

test("cierre de ciclo: cumplimiento alto -> PROGRESS y rutina nueva más exigente", { skip }, async () => {
  const db = await createSeededDb();
  const { m, routineId, days } = await memberWithRoutine(db);
  await addSessions(db, m, days, { completed: 11 }); // 11 de 12 = 91,7%
  const r = await closeCycle(db, routineId);
  assert.equal(r.decision, "PROGRESS");
  assert.ok(r.adherencePct > 90);

  const active = await getActiveRoutine(db, m.id);
  assert.equal(active.cycle_number, 2);
  assert.equal(active.params.prog.setsBonus, 1);
  assert.equal(active.starts_on, localDate());
  const { rows: old } = await db.query("SELECT status FROM routines WHERE id = $1", [routineId]);
  assert.equal(old[0].status, "FINISHED");
  const { rows: sum } = await db.query("SELECT * FROM cycle_summaries WHERE routine_id = $1", [routineId]);
  assert.equal(sum[0].decision, "PROGRESS");
  assert.equal(sum[0].completed_sessions, 11);

  // Idempotente: cerrar de nuevo no duplica nada
  assert.equal(await closeCycle(db, routineId), null);
  const { rows: cnt } = await db.query("SELECT COUNT(*)::int AS n FROM routines WHERE member_id = $1", [m.id]);
  assert.equal(cnt[0].n, 2);
  await db.close();
});

test("cierre de ciclo: los días a medias suman medio punto y el cumplimiento bajo simplifica", { skip }, async () => {
  const db = await createSeededDb();
  const { m, routineId, days } = await memberWithRoutine(db);
  await addSessions(db, m, days, { completed: 4, partialExercises: 3 });
  const { rows: rt } = await db.query("SELECT id FROM routines WHERE id = $1", [routineId]);
  const meas = await measureAdherence(db, rt[0], 3);
  assert.equal(meas.completed, 4);
  assert.equal(meas.partial, 1);
  assert.ok(meas.adherencePct > 33 && meas.adherencePct < 40, `4 + ~0,25 de 12 = ~35% (dio ${meas.adherencePct})`);
  const r = await closeCycle(db, routineId);
  assert.equal(r.decision, "SIMPLIFY");
  await db.close();
});

test("cierre de ciclo: socio inactivo no recibe rutina nueva", { skip }, async () => {
  const db = await createSeededDb();
  const { m, routineId } = await memberWithRoutine(db);
  await db.query("UPDATE members SET active = FALSE WHERE id = $1", [m.id]);
  const r = await closeCycle(db, routineId);
  assert.equal(r.nextRoutineId, null);
  assert.equal(await getActiveRoutine(db, m.id), null);
  await db.close();
});

test("closeDueCycles: solo cierra los ciclos vencidos y un error no frena al resto", { skip }, async () => {
  const db = await createSeededDb();
  const a = await memberWithRoutine(db, { nombre: "A", sede: "Olivos" });
  const b = await addMember(db, { nombre: "B" });
  await createRoutine(db, { ...b, sede_nombre: "Olivos" }, { cycleNumber: 1, startsOn: localDate() }); // todavía vigente
  const c = await memberWithRoutine(db, { nombre: "C", sede: "Martínez" });
  // Martínez se queda sin equipamiento: no se puede armar el ciclo siguiente de C
  await db.query("DELETE FROM sede_equipment WHERE sede_id = $1", [c.m.sede_id]);

  const results = await closeDueCycles(db);
  assert.deepEqual(results.map((r) => r.routineId).sort(), [a.routineId, c.routineId].sort(), "B no vence todavía");
  const ra = results.find((r) => r.routineId === a.routineId);
  const rc = results.find((r) => r.routineId === c.routineId);
  assert.ok(ra.decision, "A se cerró bien");
  assert.match(rc.error, /equipamiento/, "C falló con un mensaje claro");

  // C no quedó cerrado a medias: sigue activo y sin resumen, así el cron lo reintenta mañana
  const { rows } = await db.query("SELECT status FROM routines WHERE id = $1", [c.routineId]);
  assert.equal(rows[0].status, "ACTIVE");
  const { rows: sums } = await db.query("SELECT 1 FROM cycle_summaries WHERE routine_id = $1", [c.routineId]);
  assert.equal(sums.length, 0);
  await db.close();
});
