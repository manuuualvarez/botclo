// Limitador de ritmo en memoria (ventana deslizante), por usuario+acción.
// Suficiente para un solo proceso (nuestro caso en dev y en el VPS); si algún
// día la app corre en varias réplicas, migrar a Redis o similar.

const buckets = new Map<string, number[]>();
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Poda defensiva para que el Map no crezca sin límite.
  if (buckets.size > MAX_BUCKETS) buckets.clear();

  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= opts.limit) {
    buckets.set(key, hits);
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((hits[0] + opts.windowMs - now) / 1000)
      ),
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterSeconds: 0 };
}

export function rateLimitMessage(result: RateLimitResult): string {
  const s = result.retryAfterSeconds;
  const cuando =
    s >= 120 ? `${Math.ceil(s / 60)} minutos` : `${s} segundos`;
  return `Demasiados intentos seguidos. Esperá ${cuando} y probá de nuevo.`;
}
