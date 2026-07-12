// Decisiones puras del ejecutor, extraídas para poder testearlas sin DB ni
// red — y para que el backtest simule EXACTAMENTE la misma política.

// Monto de la próxima compra DCA: el chunk configurado (o presupuesto/10 por
// defecto, nunca menos de 10 USDT), acotado por lo que queda del presupuesto.
export function dcaChunk(
  montoPorCompra: number | undefined,
  budgetUsdt: number,
  investedUsdt: number
): number {
  const chunk = montoPorCompra ?? Math.max(10, budgetUsdt / 10);
  return Math.min(chunk, budgetUsdt - investedUsdt);
}

// ¿Ya pasó el período entre compras DCA?
export function dcaDue(
  lastBuyAt: Date | null,
  now: Date,
  intervalMs: number,
  cadaNVelas: number
): boolean {
  const everyMs = intervalMs * Math.max(1, Math.round(cadaNVelas));
  return !lastBuyAt || now.getTime() - lastBuyAt.getTime() >= everyMs;
}
