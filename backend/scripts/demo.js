// Modo demo: levanta la app COMPLETA con una base en memoria (sin Postgres, sin cuentas).
// Sirve para probarla en tu compu en 1 minuto. Al cerrar el proceso, los datos se pierden.
//
//   npm run dataset:fetch   (una sola vez)
//   npm run demo
//
// Usa OPENROUTER_API_KEY si la tenés en el entorno; si no, la IA queda apagada.

const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
const { SCHEMA_PATH } = require("../src/db");
const { importCatalog } = require("../src/importer");
const { createApp } = require("../src/app");
const { createAi } = require("../src/ai");
const { createRoutine } = require("../src/routines");
const { randomToken } = require("../src/util");

async function main() {
  const datasetDir = path.resolve(process.env.DATASET_DIR || path.join(__dirname, "../dataset"));
  const jsonPath = path.join(datasetDir, "data/exercises.json");
  if (!fs.existsSync(jsonPath)) {
    console.error(`No encuentro el dataset en ${datasetDir}\nCorré primero: npm run dataset:fetch`);
    process.exit(1);
  }

  const pg = new PGlite();
  await pg.exec(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const db = {
    query: (t, p) => pg.query(t, p),
    tx: (fn) => pg.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    close: () => pg.close(),
  };
  console.log("Importando el catálogo…");
  await importCatalog(db, JSON.parse(fs.readFileSync(jsonPath, "utf8")));

  // Un socio de ejemplo con rutina armada y otro que todavía tiene que elegir sus opciones
  const { rows: sedes } = await db.query("SELECT id FROM sedes ORDER BY id LIMIT 1");
  const mk = async (nombre, prefs) => {
    const token = randomToken();
    const { rows } = await db.query(
      `INSERT INTO members (nombre, sede_id, access_token, level, days_per_week, focus, onboarded_at)
       VALUES ($1, $2, $3, $4, $5, $6, ${prefs ? "now()" : "NULL"}) RETURNING *`,
      [nombre, sedes[0].id, token, prefs?.level ?? null, prefs?.days ?? null, prefs?.focus ?? null]
    );
    if (prefs) await createRoutine(db, rows[0], { cycleNumber: 1 });
    return token;
  };
  const t1 = await mk("Socio Demo", { level: 2, days: 4, focus: "hipertrofia" });
  const t2 = await mk("Socio Nuevo", null);

  const adminKey = process.env.ADMIN_KEY || "demo-admin-key-123456";
  const port = Number(process.env.PORT || 3000);
  const ai = createAi();
  createApp({ db, ai, adminKey, mediaDir: datasetDir, publicUrl: `http://localhost:${port}` }).listen(port, () => {
    console.log(`\nDemo lista en http://localhost:${port}`);
    console.log(`  Socio con rutina:    http://localhost:${port}/s/${t1}`);
    console.log(`  Socio sin completar: http://localhost:${port}/s/${t2}`);
    console.log(`  Panel del profe:     http://localhost:${port}/admin   (clave: ${adminKey})`);
    console.log(ai.enabled ? `  IA activa (${ai.model})` : "  IA apagada (definí OPENROUTER_API_KEY para probar reemplazos con IA y el agente)");
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
