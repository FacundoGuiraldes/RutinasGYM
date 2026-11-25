// Ayudas para los tests: base Postgres en memoria (PGlite) + catálogo real si está descargado.

const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { SCHEMA_PATH } = require("../src/db");
const { importCatalog } = require("../src/importer");

// Mismo contrato que createPgDb: query / tx / close
async function createTestDb() {
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return {
    query: (t, p) => pg.query(t, p),
    tx: (fn) => pg.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    close: () => pg.close(),
  };
}

// Dónde buscar el dataset: DATASET_DIR, backend/dataset o la copia de trabajo de desarrollo
function findDatasetFile() {
  const candidates = [
    process.env.DATASET_DIR && path.join(process.env.DATASET_DIR, "data/exercises.json"),
    path.join(__dirname, "../dataset/data/exercises.json"),
    path.join(__dirname, "../../data-src/exercises-dataset/data/exercises.json"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

// Base con el catálogo completo importado (o null si no hay dataset)
async function createSeededDb() {
  const file = findDatasetFile();
  if (!file) return null;
  const db = await createTestDb();
  await importCatalog(db, JSON.parse(fs.readFileSync(file, "utf8")));
  return db;
}

// Un socio de prueba ya con preferencias
async function addMember(db, { nombre = "Test", sede = "Olivos", level = 2, days = 3, focus = "general", onboarded = true } = {}) {
  const { rows: s } = await db.query("SELECT id FROM sedes WHERE nombre = $1", [sede]);
  const { randomToken } = require("../src/util");
  const { rows } = await db.query(
    `INSERT INTO members (nombre, sede_id, access_token, level, days_per_week, focus, onboarded_at)
     VALUES ($1, $2, $3, $4, $5, $6, ${onboarded ? "now()" : "NULL"}) RETURNING *`,
    [nombre, s[0].id, randomToken(), onboarded ? level : null, onboarded ? days : null, onboarded ? focus : null]
  );
  return rows[0];
}

module.exports = { createTestDb, createSeededDb, findDatasetFile, addMember };
