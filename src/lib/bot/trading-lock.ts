import { pg } from "../../db";

export const TRADING_LOCK_KEY = 918_273_645;

// Toda mutación operativa usa la misma sesión reservada, incluidas las
// acciones manuales. La caída del proceso libera el advisory lock en PG.
export async function withTradingLock<T>(work: () => Promise<T>): Promise<T> {
  const connection = await pg.reserve();
  try {
    const [{ locked }] = await connection`SELECT pg_try_advisory_lock(${TRADING_LOCK_KEY}) AS locked`;
    if (!locked) throw new Error("Hay una revisión del robot en curso. Intentá de nuevo en unos segundos.");
    try { return await work(); }
    finally { await connection`SELECT pg_advisory_unlock(${TRADING_LOCK_KEY})`; }
  } finally { connection.release(); }
}
