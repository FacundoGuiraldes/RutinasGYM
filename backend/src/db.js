// Capa de base de datos. Todo el código usa SOLO esta interfaz:
//   db.query(texto, parametros)  -> { rows }
//   db.tx(async (t) => { ... t.query(...) ... })  -> transacción (COMMIT/ROLLBACK automático)
//   db.close()
// Así los tests pueden usar PGlite (Postgres en memoria) y producción usa pg + Neon.

const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const SCHEMA_PATH = path.join(__dirname, "../sql/schema.sql");

function createPgDb(connectionString) {
  const pool = new Pool({ connectionString, max: 5 });
  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// Crea/actualiza las tablas. Se puede correr las veces que haga falta.
async function migrate(db) {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf8");
  await db.query(sql);
}

module.exports = { createPgDb, migrate, SCHEMA_PATH };
