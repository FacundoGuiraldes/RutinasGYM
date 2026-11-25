// Punto de entrada: lee la configuración del entorno, conecta la base y levanta el servidor.
// Variables (ver .env.example): DATABASE_URL, ADMIN_KEY, OPENROUTER_API_KEY, AI_MODEL,
// DATASET_DIR, MEDIA_BASE_URL, PUBLIC_URL, PORT.

const path = require("node:path");
const cron = require("node-cron");
const { createPgDb, migrate } = require("./db");
const { createAi } = require("./ai");
const { createApp } = require("./app");
const { closeDueCycles } = require("./progression");
const { ensureCustomExercises } = require("./importer");

async function main() {
  const { DATABASE_URL, ADMIN_KEY } = process.env;
  if (!DATABASE_URL) throw new Error("Falta DATABASE_URL");
  if (!ADMIN_KEY) throw new Error("Falta ADMIN_KEY (una clave larga que solo conozcas vos)");

  const db = createPgDb(DATABASE_URL);
  await migrate(db);
  try { const n = await ensureCustomExercises(db); if (n) console.log(`Ejercicios propios agregados: ${n}`); } catch (err) { console.error("No se pudieron agregar los ejercicios propios:", err.message); }

  const datasetDir = path.resolve(process.env.DATASET_DIR || path.join(__dirname, "../dataset"));
  const ai = createAi();
  const app = createApp({
    db,
    ai,
    adminKey: ADMIN_KEY,
    mediaDir: datasetDir,
    mediaBase: process.env.MEDIA_BASE_URL || "/media",
    publicUrl: process.env.PUBLIC_URL || "",
    trustProxy: process.env.TRUST_PROXY === "1",
  });

  // Todos los días a las 03:10 (hora Argentina) se cierran los ciclos vencidos y se generan los nuevos
  cron.schedule(
    "10 3 * * *",
    async () => {
      try {
        const results = await closeDueCycles(db);
        if (results.length) console.log("Ciclos cerrados:", JSON.stringify(results));
      } catch (err) {
        console.error("Error en el cierre de ciclos:", err);
      }
    },
    { timezone: "America/Argentina/Buenos_Aires" }
  );

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`App de rutinas en http://localhost:${port}  (admin: /admin)`);
    console.log(ai.enabled ? `IA activa (${ai.model})` : "IA desactivada: sin OPENROUTER_API_KEY los reemplazos usan reglas y el agente admin no está disponible");
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
