import { defineConfig } from "drizzle-kit";

// DATABASE_URL apunta al host "db" (red interna de Docker), por eso los
// comandos de drizzle-kit se corren DENTRO del contenedor: pnpm db:push:docker
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
