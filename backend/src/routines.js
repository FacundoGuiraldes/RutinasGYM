// Servicio de rutinas: crear el ciclo de un socio en la base y armar la vista que ve la app.

const { generateRoutine, loadPool, DEFAULT_PROG, estimateMinutes } = require("./generator");
const { areaLabels } = require("./limitations");
const { equipmentInfo, targetLabel } = require("./equipment");
const { translateName } = require("./namesEs");
const { localDate, addDays, weekStart } = require("./util");
const { AppError } = require("./errors");

const CYCLE_DAYS = 28; // un ciclo dura 4 semanas
const WEEKS_PER_CYCLE = CYCLE_DAYS / 7;

// Genera y guarda la rutina de un ciclo. Devuelve { routineId, warnings }.
async function createRoutine(db, member, { cycleNumber, prog = DEFAULT_PROG, prevIds = new Set(), startsOn = localDate() } = {}) {
  const pool = await loadPool(db, member.sede_id, { limitations: member.limitations ?? [] });
  const gen = generateRoutine({
    pool,
    member: {
      id: member.id, level: member.level, daysPerWeek: member.days_per_week, focus: member.focus,
      gender: member.gender, priorities: member.priorities, sessionMinutes: member.session_minutes,
    },
    cycleNumber,
    prog,
    prevIds,
  });

  // Control de calidad (quality.js): se guarda con la rutina para que el profe vea si quedó alguna falla sin resolver
  gen.params.quality = { ok: gen.quality.ok, score: gen.quality.score, attempts: gen.quality.attempts, blockers: gen.quality.blockers.map((b) => b.msg), warnings: gen.quality.warnings.map((w) => w.msg).slice(0, 8) };
  if (!gen.quality.ok) gen.warnings.push(...gen.quality.blockers.map((b) => `Control de calidad: ${b.msg}`));

  const total = gen.days.reduce((a, d) => a + d.exercises.length, 0);
  if (total === 0) {
    throw new AppError(409, "EMPTY_POOL", "La sede no tiene ejercicios disponibles para armar la rutina (revisá el equipamiento de la sede).");
  }

  const routineId = await db.tx(async (t) => {
    const { rows } = await t.query(
      `INSERT INTO routines (member_id, cycle_number, status, starts_on, ends_on, params)
       VALUES ($1, $2, 'ACTIVE', $3::date, $4::date, $5::jsonb) RETURNING id`,
      [member.id, cycleNumber, startsOn, addDays(startsOn, CYCLE_DAYS), JSON.stringify(gen.params)]
    );
    const id = rows[0].id;
    for (const day of gen.days) {
      const { rows: d } = await t.query(
        "INSERT INTO routine_days (routine_id, day_index, label) VALUES ($1, $2, $3) RETURNING id",
        [id, day.dayIndex, day.label]
      );
      for (const ex of day.exercises) {
        await t.query(
          `INSERT INTO routine_exercises (day_id, exercise_id, position, sets, reps, rest_sec, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [d[0].id, ex.exerciseId, ex.position, ex.sets, ex.reps, ex.restSec, ex.note]
        );
      }
    }
    return id;
  });

  return { routineId, warnings: gen.warnings, params: gen.params };
}

async function getActiveRoutine(db, memberId) {
  const { rows } = await db.query(
    `SELECT id, member_id, cycle_number, status, starts_on::text AS starts_on, ends_on::text AS ends_on, params
     FROM routines WHERE member_id = $1 AND status = 'ACTIVE' ORDER BY cycle_number DESC LIMIT 1`,
    [memberId]
  );
  return rows[0] ?? null;
}

// IDs de ejercicios que tuvo el socio en su último ciclo (para no repetirlos al renovar)
async function previousExerciseIds(db, memberId) {
  const { rows } = await db.query(
    `SELECT DISTINCT re.exercise_id
     FROM routine_exercises re
     JOIN routine_days d ON d.id = re.day_id
     JOIN routines r ON r.id = d.routine_id
     WHERE r.member_id = $1 AND r.cycle_number = (SELECT MAX(cycle_number) FROM routines WHERE member_id = $1)`,
    [memberId]
  );
  return new Set(rows.map((r) => r.exercise_id));
}

function mediaUrl(base, p) {
  return `${base.replace(/\/$/, "")}/${p}`;
}

// Semana de descarga: la última semana del ciclo. Principiantes la hacen cada 8 semanas (ciclos pares);
// intermedios y avanzados, cada 4. Se aplica al mostrar: mismo peso, la mitad de las series, lejos del fallo.
function weekOfCycle(startsOn, today) {
  const diff = Math.floor((new Date(`${today}T00:00:00Z`) - new Date(`${String(startsOn).slice(0, 10)}T00:00:00Z`)) / 86400000);
  return Math.min(WEEKS_PER_CYCLE, Math.max(1, Math.floor(diff / 7) + 1));
}
function isDeloadWeek({ level, cycleNumber, startsOn, today }) {
  const everyCycle = level >= 2;
  return weekOfCycle(startsOn, today) === WEEKS_PER_CYCLE && (everyCycle || cycleNumber % 2 === 0);
}
const DELOAD_NOTE = "Semana de descarga: mismo peso y la mitad de las series, sin llegar al fallo.";

// Todo lo que necesita la pantalla del socio en una sola llamada
async function buildMemberView(db, member, { mediaBase = "/media", today = localDate() } = {}) {
  const base = {
    member: {
      nombre: member.nombre,
      sede: member.sede_nombre,
      onboarded: Boolean(member.onboarded_at),
      level: member.level,
      daysPerWeek: member.days_per_week,
      focus: member.focus,
      gender: member.gender ?? null,
      priorities: member.priorities ?? null,
      sessionMinutes: member.session_minutes ?? null,
      limitations: areaLabels(member.limitations),
    },
    routine: null,
  };
  if (!member.onboarded_at) return base;

  const routine = await getActiveRoutine(db, member.id);
  if (!routine) return base;

  const { rows: days } = await db.query(
    "SELECT id, day_index, label FROM routine_days WHERE routine_id = $1 ORDER BY day_index",
    [routine.id]
  );
  const { rows: exs } = await db.query(
    `SELECT re.id, re.day_id, re.position, re.sets, re.reps, re.rest_sec, re.note, re.replaced_from_id,
            e.id AS exercise_id, e.name_es, e.name AS name_en, e.target, e.movement_pattern AS pattern, e.secondary_muscles, e.gif_path, e.image_path,
            e.steps_es, e.attribution, q.key AS equipment
     FROM routine_exercises re
     JOIN routine_days d ON d.id = re.day_id
     JOIN exercises e ON e.id = re.exercise_id
     JOIN equipment q ON q.id = e.equipment_id
     WHERE d.routine_id = $1
     ORDER BY d.day_index, re.position`,
    [routine.id]
  );

  // Sesiones de hoy (lo tildado hoy) y de la semana (para "2 de 3 días")
  const { rows: sessions } = await db.query(
    `SELECT s.id, s.routine_day_id, s.session_date::text AS session_date, s.completed_at
     FROM sessions s JOIN routine_days d ON d.id = s.routine_day_id
     WHERE d.routine_id = $1`,
    [routine.id]
  );
  const todaySessions = new Map(sessions.filter((s) => s.session_date === today).map((s) => [s.routine_day_id, s]));
  const { rows: doneRows } = await db.query(
    `SELECT se.routine_exercise_id, se.session_id FROM session_exercises se
     JOIN sessions s ON s.id = se.session_id
     JOIN routine_days d ON d.id = s.routine_day_id
     WHERE d.routine_id = $1 AND s.session_date = $2::date`,
    [routine.id, today]
  );
  const doneToday = new Set(doneRows.map((r) => r.routine_exercise_id));

  const deload = isDeloadWeek({ level: member.level ?? 1, cycleNumber: routine.cycle_number, startsOn: routine.starts_on, today });
  if (deload) for (const x of exs) x.sets = Math.max(1, Math.ceil(x.sets / 2));

  const wk = weekStart(today);
  const weekDone = sessions.filter((s) => s.completed_at && s.session_date >= wk && s.session_date <= addDays(wk, 6)).length;
  const cycleDone = sessions.filter((s) => s.completed_at).length;

  return {
    ...base,
    routine: {
      id: routine.id,
      cycleNumber: routine.cycle_number,
      startsOn: routine.starts_on,
      endsOn: routine.ends_on,
      priorities: routine.params?.priorities ?? [],
      quality: routine.params?.quality ?? null,
      weekOfCycle: weekOfCycle(routine.starts_on, today),
      deload,
      deloadNote: deload ? DELOAD_NOTE : null,
      days: days.map((d) => ({
        id: d.id,
        dayIndex: d.day_index,
        label: d.label,
        estMinutes: estimateMinutes(exs.filter((x) => x.day_id === d.id).map((x) => ({ sets: x.sets, restSec: x.rest_sec }))),
        completedToday: Boolean(todaySessions.get(d.id)?.completed_at),
        exercises: exs
          .filter((x) => x.day_id === d.id)
          .map((x) => ({
            id: x.id,
            position: x.position,
            sets: x.sets,
            reps: x.reps,
            restSec: x.rest_sec,
            note: x.note,
            replaced: Boolean(x.replaced_from_id),
            done: doneToday.has(x.id),
            exercise: {
              id: x.exercise_id,
              name: x.name_es ?? (() => { const t = translateName(x.name_en); return t.complete ? t.es : x.name_en; })(), // si no estaba traducido en la base, se traduce al mostrar
              target: x.target,
              targetLabel: targetLabel(x.target, x.pattern),
              equipment: x.equipment,
              equipmentLabel: equipmentInfo(x.equipment).label,
              secondary: x.secondary_muscles ?? [],
              steps: x.steps_es ?? [],
              gifUrl: mediaUrl(mediaBase, x.gif_path),
              imageUrl: mediaUrl(mediaBase, x.image_path),
            },
          })),
      })),
    },
    progress: {
      week: { done: weekDone, planned: member.days_per_week },
      cycle: { done: cycleDone, planned: member.days_per_week * WEEKS_PER_CYCLE },
    },
    attribution: exs.find((x) => x.attribution)?.attribution ?? "© Gym visual — https://gymvisual.com/",
  };
}

module.exports = { isDeloadWeek, weekOfCycle, createRoutine, getActiveRoutine, previousExerciseIds, buildMemberView, CYCLE_DAYS, WEEKS_PER_CYCLE };
