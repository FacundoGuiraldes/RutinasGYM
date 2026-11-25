// Progresión mensual basada en CUMPLIMIENTO (no en pesos cargados).
//
// Al terminar el ciclo se mide cuánto cumplió el socio:
//   - cada día marcado "completo" vale 1
//   - un día con ejercicios tildados pero sin cerrar vale hasta 0,5 (proporcional a lo tildado)
//   - cumplimiento = suma / (días por semana x 4 semanas), máximo 100%
// Con eso se decide:
//   >= 85%  PROGRESS  sube UNA palanca: series, ejercicios por día o dificultad (rotando) + sugiere más carga
//   60-84%  MAINTAIN  misma carga, ejercicios renovados
//   <  60%  SIMPLIFY  baja un escalón (menos ejercicios o menos series)

const { DEFAULT_PROG } = require("./generator");
const { createRoutine, previousExerciseIds, WEEKS_PER_CYCLE } = require("./routines");
const { localDate } = require("./util");

const THRESHOLDS = { progress: 85, maintain: 60 };
const CAPS = { setsBonus: 2, extraPerDay: 2, levelBoost: 1, loadStep: 6 };
const LEVERS = ["setsBonus", "extraPerDay", "levelBoost"];
const LEVER_TEXT = {
  setsBonus: "Sumamos una serie en los ejercicios principales.",
  extraPerDay: "Sumamos un ejercicio más por día.",
  levelBoost: "Subimos la dificultad: variantes más exigentes.",
};

function decide(adherencePct) {
  if (adherencePct >= THRESHOLDS.progress) return "PROGRESS";
  if (adherencePct >= THRESHOLDS.maintain) return "MAINTAIN";
  return "SIMPLIFY";
}

// Calcula el nuevo estado de progresión. Es una función pura: fácil de testear.
function nextProg(prog, decision, { cycleNumber, memberLevel }) {
  const p = { ...DEFAULT_PROG, ...prog };
  const changes = [];

  if (decision === "PROGRESS") {
    // La palanca con la que arrancamos rota cada ciclo para repartir la exigencia
    const start = (cycleNumber - 1) % LEVERS.length;
    let applied = false;
    for (let i = 0; i < LEVERS.length && !applied; i++) {
      const lever = LEVERS[(start + i) % LEVERS.length];
      const cap = lever === "levelBoost" ? Math.min(CAPS.levelBoost, 3 - memberLevel) : CAPS[lever];
      if (p[lever] < cap) {
        p[lever] += 1;
        changes.push(LEVER_TEXT[lever]);
        applied = true;
      }
    }
    if (p.loadStep < CAPS.loadStep) p.loadStep += 1;
    changes.push("Sugerimos subir un escalón de carga respecto del mes pasado.");
    if (!applied) changes.unshift("Ya estás en el máximo de volumen y dificultad: la progresión pasa por la carga.");
  } else if (decision === "SIMPLIFY") {
    if (p.extraPerDay > 0) {
      p.extraPerDay -= 1;
      changes.push("Quitamos un ejercicio por día para que sea más llevadero.");
    } else if (p.setsBonus > -1) {
      p.setsBonus -= 1;
      changes.push("Bajamos una serie en los ejercicios principales.");
    } else if (p.levelBoost > 0) {
      p.levelBoost -= 1;
      changes.push("Bajamos un escalón de dificultad.");
    } else {
      changes.push("Mantenemos el volumen mínimo: probá fijar días más realistas con tu profe.");
    }
    p.loadStep = Math.max(0, p.loadStep - 1);
  } else {
    changes.push("Mantenemos la misma exigencia y renovamos los ejercicios.");
  }
  return { prog: p, changes };
}

// Cumplimiento de un ciclo según las sesiones registradas
async function measureAdherence(db, routine, daysPerWeek) {
  const { rows: sessions } = await db.query(
    `SELECT s.id, s.completed_at,
            (SELECT COUNT(*)::int FROM session_exercises se WHERE se.session_id = s.id) AS done,
            (SELECT COUNT(*)::int FROM routine_exercises re WHERE re.day_id = s.routine_day_id) AS total
     FROM sessions s JOIN routine_days d ON d.id = s.routine_day_id
     WHERE d.routine_id = $1`,
    [routine.id]
  );
  const planned = daysPerWeek * WEEKS_PER_CYCLE;
  let score = 0;
  let completed = 0;
  let partial = 0;
  for (const s of sessions) {
    if (s.completed_at) {
      score += 1;
      completed += 1;
    } else if (s.done > 0 && s.total > 0) {
      score += 0.5 * (s.done / s.total);
      partial += 1;
    }
  }
  const adherencePct = Math.round(Math.min(1, score / planned) * 1000) / 10;
  return { planned, completed, partial, adherencePct };
}

// Cierra un ciclo: guarda el resumen y (si el socio sigue activo) crea el ciclo siguiente.
async function closeCycle(db, routineId, { today = localDate() } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.member_id, r.cycle_number, r.status, r.params, m.active, m.days_per_week
     FROM routines r JOIN members m ON m.id = r.member_id WHERE r.id = $1`,
    [routineId]
  );
  const routine = rows[0];
  if (!routine) throw new Error(`Rutina ${routineId} no existe`);
  const { rows: exists } = await db.query("SELECT 1 FROM cycle_summaries WHERE routine_id = $1", [routineId]);
  if (exists.length || routine.status !== "ACTIVE") return null; // ya cerrado: idempotente

  const m = await measureAdherence(db, routine, routine.days_per_week);
  const decision = decide(m.adherencePct);
  const memberLevel = routine.params?.level ?? 1;
  const { prog, changes } = nextProg(routine.params?.prog, decision, { cycleNumber: routine.cycle_number, memberLevel });

  // Primero se genera el ciclo siguiente: si falla (ej: la sede se quedó sin equipamiento), no se cierra
  // nada y el cron lo reintenta mañana, en vez de dejar al socio sin rutina.
  let nextRoutineId = null;
  if (routine.active) {
    const { rows: already } = await db.query("SELECT id FROM routines WHERE member_id = $1 AND cycle_number = $2", [routine.member_id, routine.cycle_number + 1]);
    if (already[0]) {
      nextRoutineId = already[0].id; // un intento anterior ya la había creado
    } else {
      const { rows: mem } = await db.query("SELECT * FROM members WHERE id = $1", [routine.member_id]);
      const prevIds = await previousExerciseIds(db, routine.member_id);
      const next = await createRoutine(db, mem[0], { cycleNumber: routine.cycle_number + 1, prog, prevIds, startsOn: today });
      nextRoutineId = next.routineId;
    }
  }

  await db.tx(async (t) => {
    await t.query(
      `INSERT INTO cycle_summaries (routine_id, planned_sessions, completed_sessions, partial_sessions, adherence_pct, decision, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [routineId, m.planned, m.completed, m.partial, m.adherencePct, decision, JSON.stringify(changes)]
    );
    await t.query("UPDATE routines SET status = 'FINISHED' WHERE id = $1", [routineId]);
    await t.query(
      `INSERT INTO change_logs (actor, member_id, action, payload) VALUES ('SYSTEM', $1, 'monthly_progression', $2::jsonb)`,
      [routine.member_id, JSON.stringify({ cycle: routine.cycle_number, adherencePct: m.adherencePct, decision, changes })]
    );
  });

  return { decision, adherencePct: m.adherencePct, changes, nextRoutineId };
}

// Para el cron diario: cierra todos los ciclos vencidos
async function closeDueCycles(db, { today = localDate() } = {}) {
  const { rows } = await db.query(
    `SELECT r.id FROM routines r JOIN members m ON m.id = r.member_id
     WHERE r.status = 'ACTIVE' AND r.ends_on <= $1::date AND m.onboarded_at IS NOT NULL ORDER BY r.id`,
    [today]
  );
  const results = [];
  for (const r of rows) {
    try {
      results.push({ routineId: r.id, ...(await closeCycle(db, r.id, { today })) });
    } catch (err) {
      // Un socio con problemas no tiene que frenar a los demás
      results.push({ routineId: r.id, error: err.message });
    }
  }
  return results;
}

module.exports = { decide, nextProg, measureAdherence, closeCycle, closeDueCycles, THRESHOLDS };
