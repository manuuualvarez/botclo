import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDunningSweep } from "@/lib/billing";
import { runAllActiveBots } from "@/lib/bot/executor";

// El barrido de cobranza corre a lo sumo una vez por hora, colgado del tick.
let lastDunningAt = 0;

// Comparación en tiempo constante: un `!==` común corta en el primer byte
// distinto y filtra información por timing.
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Tick del robot: lo llama el servicio "bot" del docker-compose cada
// BOT_TICK_SECONDS. Protegido por secreto compartido, no por Clerk.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get("x-cron-secret"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const outcomes = await runAllActiveBots();

  if (Date.now() - lastDunningAt > 60 * 60_000) {
    lastDunningAt = Date.now();
    await runDunningSweep().catch((e) =>
      console.error("[dunning]", e)
    );
  }
  const traded = outcomes.filter(
    (o) => o.action === "buy" || o.action === "sell"
  );
  // Solo un conteo agregado en los logs — sin userId ni montos (privacidad).
  if (traded.length > 0) {
    console.log(`[bot] ${traded.length} operación(es) ejecutada(s) este tick`);
  }
  return NextResponse.json({ processed: outcomes.length });
}
