// Formateo es-AR: "US$ 1.234,56" — familiar para el público argentino.

import { INTERVAL_MS, type KlineInterval } from "@/lib/intervals";

const usd = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const usdPrecise = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});

const amount = new Intl.NumberFormat("es-AR", {
  maximumSignificantDigits: 8,
});

const pct = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  signDisplay: "always",
});

export function formatUsd(value: number): string {
  // Precios chicos (p. ej. SHIB) necesitan más decimales para no mostrar $0,00.
  return value > 0 && value < 0.01 ? usdPrecise.format(value) : usd.format(value);
}

export function formatAmount(value: number): string {
  return amount.format(value);
}

export function formatPct(value: number): string {
  return `${pct.format(value)}%`;
}

// Traduce "N velas de tal intervalo" a tiempo humano: la unidad "velas" no
// le dice nada a un usuario no técnico.
export function humanizeCandles(count: number, interval: string): string {
  const intervalMs = INTERVAL_MS[interval as KlineInterval] ?? INTERVAL_MS["1d"];
  const hours = count * (intervalMs / 3_600_000);
  if (!Number.isFinite(hours) || hours <= 0) return "";
  if (hours < 48) {
    const h = Math.round(hours);
    return `≈ ${h} hora${h === 1 ? "" : "s"}`;
  }
  const days = hours / 24;
  if (days < 45) {
    const d = Math.round(days);
    return `≈ ${d} día${d === 1 ? "" : "s"}`;
  }
  const months = days / 30;
  return `≈ ${months < 10 ? Math.round(months * 2) / 2 : Math.round(months)} meses`.replace(".5", ",5");
}

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}
