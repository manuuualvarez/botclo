import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// En dev, Next recarga módulos con cada cambio: la conexión se cuelga de
// globalThis para no abrir un pool nuevo en cada hot-reload.
const globalForDb = globalThis as unknown as { pgConn?: postgres.Sql };

const conn =
  globalForDb.pgConn ?? postgres(process.env.DATABASE_URL!, { max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pgConn = conn;

export const db = drizzle(conn, { schema });
