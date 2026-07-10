// Indicadores técnicos como arrays alineados con la serie de entrada:
// resultado[i] corresponde a values[i]; null mientras no hay datos suficientes.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// EMA clásica: semilla = SMA de las primeras `period` velas, luego recursiva.
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// Desvío estándar poblacional móvil (para Bandas de Bollinger).
export function rollingStd(
  values: number[],
  period: number
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sq += (values[j] - mean) ** 2;
    }
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

// ATR con suavizado de Wilder: mide la volatilidad (para stops adaptativos).
export function atr(
  candles: { high: number; low: number; close: number }[],
  period = 14
): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;

  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    trueRanges.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }

  let value = 0;
  for (let i = 0; i < period; i++) value += trueRanges[i];
  value /= period;
  out[period - 1] = value;
  for (let i = period; i < candles.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
    out[i] = value;
  }
  return out;
}

// MACD(f, s, g): línea = EMA_f − EMA_s; señal = EMA_g de la línea.
export function macd(
  values: number[],
  fast: number,
  slow: number,
  signalPeriod: number
): { line: (number | null)[]; signal: (number | null)[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line: (number | null)[] = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null
  );

  // La señal es una EMA sobre la línea (ignorando el warmup nulo).
  const firstIdx = line.findIndex((v) => v !== null);
  const signal: (number | null)[] = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const compactSignal = ema(compact, signalPeriod);
    for (let i = 0; i < compactSignal.length; i++) {
      signal[firstIdx + i] = compactSignal[i];
    }
  }
  return { line, signal };
}

// Canal de Donchian: máximo/mínimo de las N velas ANTERIORES a i (sin incluir
// la vela i — incluirla sería mirar el futuro de la propia señal).
export function highestHigh(
  candles: { high: number }[],
  n: number,
  i: number
): number | null {
  if (i - n < 0) return null;
  let max = -Infinity;
  for (let j = i - n; j < i; j++) max = Math.max(max, candles[j].high);
  return max;
}

export function lowestLow(
  candles: { low: number }[],
  m: number,
  i: number
): number | null {
  if (i - m < 0) return null;
  let min = Infinity;
  for (let j = i - m; j < i; j++) min = Math.min(min, candles[j].low);
  return min;
}

// ROC: rendimiento porcentual contra k velas atrás.
export function roc(values: number[], k: number): (number | null)[] {
  return values.map((v, i) =>
    i >= k && values[i - k] !== 0 ? 100 * (v / values[i - k] - 1) : null
  );
}

// RSI con suavizado de Wilder (el clásico de 14 períodos).
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss -= delta;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
