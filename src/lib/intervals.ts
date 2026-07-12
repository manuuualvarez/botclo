// Única fuente de verdad sobre los intervalos de vela soportados. Todo lo
// que dependa de un intervalo (milisegundos, velas por día, etiqueta) se
// deriva de acá — mapas paralelos en distintos módulos ya driftearon una vez.

export type KlineInterval = "1h" | "4h" | "1d";

export const INTERVAL_MS: Record<KlineInterval, number> = {
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

// Velas que entran en un día: el período de un backtest se traduce a
// CANTIDAD DE VELAS del intervalo real de la estrategia.
export function candlesPerDay(interval: KlineInterval): number {
  return 86_400_000 / INTERVAL_MS[interval];
}

// Etiqueta en criollo para usuarios no técnicos.
export const INTERVAL_LABELS: Record<KlineInterval, string> = {
  "1h": "Cada hora",
  "4h": "Cada 4 horas",
  "1d": "Una vez por día",
};
