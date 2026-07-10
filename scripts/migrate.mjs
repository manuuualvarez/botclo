// Aplica las migraciones versionadas de drizzle/ antes de arrancar el server.
// Corre en el contenedor de producción (ver Dockerfile runner). Es idempotente:
// drizzle lleva registro de qué migraciones ya aplicó, así que re-ejecutarlo
// no duplica nada.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] falta DATABASE_URL");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
try {
  await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
  console.log("[migrate] migraciones aplicadas ✓");
} catch (e) {
  console.error("[migrate] error aplicando migraciones:", e);
  process.exit(1);
} finally {
  await sql.end();
}
