// Decisiones puras del ejecutor, extraídas para poder testearlas sin DB ni
// red — y para que el backtest simule EXACTAMENTE la misma política.

// Piso del monto por compra DCA: mínimo notional de Binance (~10 USDT) con
// margen. ÚNICO lugar donde vive este número.
export const MIN_DCA_CHUNK_USD = 11;

// Normaliza el monto por compra que eligió el usuario (o su ausencia) contra
// un presupuesto. La usan la creación de robots Y el laboratorio: si
// clampearan distinto, el backtest simularía chunks que el robot nunca usa.
export function clampDcaChunk(
  raw: number | undefined,
  budgetUsdt: number
): number {
  return Math.min(
    budgetUsdt,
    Math.max(
      MIN_DCA_CHUNK_USD,
      raw !== undefined && Number.isFinite(raw) ? raw : budgetUsdt / 10
    )
  );
}

// Monto de la próxima compra DCA: el chunk configurado (o presupuesto/10 por
// defecto), acotado por lo que queda del presupuesto.
export function dcaChunk(
  montoPorCompra: number | undefined,
  budgetUsdt: number,
  investedUsdt: number
): number {
  const chunk =
    montoPorCompra ?? Math.max(MIN_DCA_CHUNK_USD, budgetUsdt / 10);
  return Math.min(chunk, budgetUsdt - investedUsdt);
}

// Milisegundos entre compras DCA (también lo muestra el insight de la UI —
// si el cálculo cambia, la "próxima compra" mostrada sigue siendo la real).
export function dcaEveryMs(intervalMs: number, cadaNVelas: number): number {
  return intervalMs * Math.max(1, Math.round(cadaNVelas));
}

// ¿Ya pasó el período entre compras DCA?
export function dcaDue(
  lastBuyAt: Date | null,
  now: Date,
  intervalMs: number,
  cadaNVelas: number
): boolean {
  return (
    !lastBuyAt ||
    now.getTime() - lastBuyAt.getTime() >= dcaEveryMs(intervalMs, cadaNVelas)
  );
}

// Presupuesto consumido después de una venta. Las PÉRDIDAS reducen lo que el
// robot puede volver a gastar (jamás repone plata del wallet más allá del
// presupuesto); las GANANCIAS no se reinvierten. Es la misma regla que el
// backtest aplica con `min(cash, capital)` — si divergen, el simulador
// miente sobre la exposición real.
export function investedAfterSell(
  investedUsdt: number,
  proceedsUsdt: number
): number {
  return Math.max(0, investedUsdt - proceedsUsdt);
}
