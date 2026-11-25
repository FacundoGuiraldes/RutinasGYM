// ============================================================
// Importa el catálogo COMPLETO de exercises-dataset a PostgreSQL.
//
// Uso:
//   node scripts/import-exercises.js --dry-run [ruta/exercises.json]   (no toca la base)
//   node scripts/import-exercises.js           [ruta/exercises.json]   (necesita DATABASE_URL)
//
// Si no pasás ruta, usa DATASET_DIR/data/exercises.json (por defecto ./dataset).
// Es idempotente y respeta tus correcciones (ver src/importer.js).
// ============================================================

const fs = require("node:fs");
const path = require("node:path");
const { createPgDb, migrate } = require("../src/db");
const { importCatalog, validate, toRow } = require("../src/importer");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const fileArg = args.find((a) => !a.startsWith("--"));
const datasetDir = path.resolve(process.env.DATASET_DIR || path.join(__dirname, "../dataset"));
const JSON_PATH = path.resolve(fileArg || path.join(datasetDir, "data/exercises.json"));

async function main() {
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`No encuentro ${JSON_PATH}\nCorré primero: npm run dataset:fetch`);
    process.exit(1);
  }
  const records = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  console.log(`Archivo: ${JSON_PATH}`);
  console.log(`Ejercicios: ${records.length}`);

  if (DRY_RUN) {
    const problems = validate(records);
    console.log(`Problemas de validación: ${problems.length}`);
    problems.slice(0, 10).forEach((p) => console.log("  -", p));
    const ids = new Map([...new Set(records.map((r) => r.equipment))].map((k, i) => [k, i + 1]));
    const count = {};
    for (const r of records) {
      const row = toRow(r, ids);
      count[row.role] = (count[row.role] || 0) + 1;
    }
    console.log("Clasificación por rol:", count);
    console.log("DRY RUN: no se escribió nada en la base de datos.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL (la cadena de conexión de Postgres/Neon).");
    process.exit(1);
  }
  const db = createPgDb(process.env.DATABASE_URL);
  try {
    await migrate(db); // por si todavía no corriste npm run migrate
    const stats = await importCatalog(db, records, { log: console.log });
    console.log("Importación terminada:", stats);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
