// Crea o actualiza las tablas en la base de DATABASE_URL. Se puede correr las veces que haga falta.
const { createPgDb, migrate } = require("../src/db");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL (la cadena de conexión de Postgres/Neon).");
    process.exit(1);
  }
  const db = createPgDb(process.env.DATABASE_URL);
  try {
    await migrate(db);
    console.log("Tablas listas.");
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
