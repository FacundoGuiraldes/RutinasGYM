// Importa el catálogo del dataset a la base. Idempotente: se puede correr de nuevo sin duplicar
// y NO pisa lo que corregiste vos (classified_by = 'admin', enabled, equipamiento por sede,
// exclusiones). Sirve igual para PGlite (tests) que para Postgres real.

const { classifyExercise } = require("./classify");

const SEDES = ["Martínez", "Olivos"];
const BATCH = 200;

// Convierte un registro crudo del dataset en la fila que guardamos
function toRow(raw, equipmentIdByKey) {
  const { role, pattern, level } = classifyExercise(raw);
  const stepsEn = raw.instruction_steps?.en ?? [];
  const stepsEs = raw.instruction_steps?.es?.length ? raw.instruction_steps.es : stepsEn;
  return {
    id: String(raw.id),
    name: raw.name,
    body_part: raw.body_part,
    target: raw.target,
    muscle_group: raw.muscle_group ?? null,
    secondary_muscles: raw.secondary_muscles ?? [],
    equipment_id: equipmentIdByKey.get(raw.equipment),
    steps_es: stepsEs,
    steps_en: stepsEn,
    image_path: raw.image,
    gif_path: raw.gif_url,
    attribution: raw.attribution ?? null,
    media_id: raw.media_id ?? null,
    role,
    movement_pattern: pattern,
    level,
  };
}

// Problemas mínimos que impiden importar un registro
function validate(records) {
  const problems = [];
  const seen = new Set();
  for (const r of records) {
    for (const f of ["id", "name", "body_part", "target", "equipment", "image", "gif_url"]) {
      if (!r[f]) problems.push(`Ejercicio ${r.id ?? "?"}: falta "${f}"`);
    }
    if (seen.has(r.id)) problems.push(`ID repetido: ${r.id}`);
    seen.add(r.id);
  }
  return problems;
}

async function importCatalog(db, records, { sedes = SEDES, log = () => {} } = {}) {
  const problems = validate(records);
  if (problems.length) throw new Error(`Dataset inválido:\n${problems.slice(0, 10).join("\n")}`);

  // 1) Sedes y equipamiento
  for (const nombre of sedes) {
    await db.query("INSERT INTO sedes (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING", [nombre]);
  }
  const keys = [...new Set(records.map((r) => r.equipment))].sort();
  for (const key of keys) {
    await db.query("INSERT INTO equipment (key) VALUES ($1) ON CONFLICT (key) DO NOTHING", [key]);
  }
  const { rows: eq } = await db.query("SELECT id, key FROM equipment");
  const equipmentIdByKey = new Map(eq.map((e) => [e.key, e.id]));

  // Por defecto todas las sedes tienen todo el equipamiento. No pisa lo que ya desactivaste.
  await db.query(
    `INSERT INTO sede_equipment (sede_id, equipment_id, available)
     SELECT s.id, e.id, TRUE FROM sedes s CROSS JOIN equipment e
     ON CONFLICT (sede_id, equipment_id) DO NOTHING`
  );

  // 2) Ejercicios en lotes (un solo viaje a la base por cada 200)
  const rows = records.map((r) => toRow(r, equipmentIdByKey));
  for (let i = 0; i < rows.length; i += BATCH) {
    const lote = rows.slice(i, i + BATCH);
    await db.query(
      `INSERT INTO exercises (id, name, body_part, target, muscle_group, secondary_muscles, equipment_id,
                              steps_es, steps_en, image_path, gif_path, attribution, media_id,
                              role, movement_pattern, level)
       SELECT x.id, x.name, x.body_part, x.target, x.muscle_group, x.secondary_muscles, x.equipment_id,
              x.steps_es, x.steps_en, x.image_path, x.gif_path, x.attribution, x.media_id,
              x.role, x.movement_pattern, x.level
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id text, name text, body_part text, target text, muscle_group text, secondary_muscles jsonb,
         equipment_id int, steps_es jsonb, steps_en jsonb, image_path text, gif_path text,
         attribution text, media_id text, role text, movement_pattern text, level int)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, body_part = EXCLUDED.body_part, target = EXCLUDED.target,
         muscle_group = EXCLUDED.muscle_group, secondary_muscles = EXCLUDED.secondary_muscles,
         equipment_id = EXCLUDED.equipment_id, steps_es = EXCLUDED.steps_es, steps_en = EXCLUDED.steps_en,
         image_path = EXCLUDED.image_path, gif_path = EXCLUDED.gif_path,
         attribution = EXCLUDED.attribution, media_id = EXCLUDED.media_id,
         -- si lo corrigió el admin, se respeta; si no, se actualiza con las reglas
         role = CASE WHEN exercises.classified_by = 'admin' THEN exercises.role ELSE EXCLUDED.role END,
         movement_pattern = CASE WHEN exercises.classified_by = 'admin' THEN exercises.movement_pattern ELSE EXCLUDED.movement_pattern END,
         level = CASE WHEN exercises.classified_by = 'admin' THEN exercises.level ELSE EXCLUDED.level END`,
      [JSON.stringify(lote)]
    );
    log(`  importados ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }

  return { exercises: rows.length, equipment: keys.length, sedes: sedes.length };
}

module.exports = { importCatalog, toRow, validate, SEDES };
