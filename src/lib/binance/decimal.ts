// Cantidades monetarias como coeficiente entero + escala. Nunca pasan por
// Number: redondear un saldo hacia arriba puede vender monedas de otro robot.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const MAX_SCALE = 100;

interface Decimal { coefficient: bigint; scale: number }

function parse(value: string): Decimal {
  if (typeof value !== "string" || value.length > 300) throw new TypeError("Decimal inválido.");
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new TypeError("Decimal inválido.");
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_SCALE || fraction.length > MAX_SCALE) {
    throw new RangeError("Precisión decimal fuera de rango.");
  }
  let coefficient = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${fraction}`);
  let scale = fraction.length - exponent;
  if (scale < 0) { coefficient *= TEN ** BigInt(-scale); scale = 0; }
  if (scale > MAX_SCALE) throw new RangeError("Precisión decimal fuera de rango.");
  return { coefficient, scale };
}

function format({ coefficient, scale }: Decimal): string {
  if (coefficient === ZERO) return "0";
  const negative = coefficient < ZERO;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const text = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "");
  return `${negative ? "-" : ""}${text}`;
}

function aligned(a: string, b: string): [bigint, bigint, number] {
  const left = parse(a); const right = parse(b);
  const scale = Math.max(left.scale, right.scale);
  return [left.coefficient * TEN ** BigInt(scale - left.scale), right.coefficient * TEN ** BigInt(scale - right.scale), scale];
}

export function normalize(value: string): string { return format(parse(value)); }
export function compare(a: string, b: string): -1 | 0 | 1 {
  const [left, right] = aligned(a, b);
  return left < right ? -1 : left > right ? 1 : 0;
}
export function add(a: string, b: string): string {
  const [left, right, scale] = aligned(a, b);
  return format({ coefficient: left + right, scale });
}
export function subtract(a: string, b: string): string {
  const [left, right, scale] = aligned(a, b);
  return format({ coefficient: left - right, scale });
}
export function multiply(a: string, b: string): string {
  const left = parse(a); const right = parse(b);
  return format({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
}

// División truncada hacia cero. Para cantidades operables usar floorToStep.
export function divide(a: string, b: string, scale = 18): string {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) throw new RangeError("Escala inválida.");
  const left = parse(a); const right = parse(b);
  if (right.coefficient === ZERO) throw new RangeError("División por cero.");
  const numerator = left.coefficient * TEN ** BigInt(right.scale + scale);
  const denominator = right.coefficient * TEN ** BigInt(left.scale);
  return format({ coefficient: numerator / denominator, scale });
}

export function floorToStep(value: string, step: string): string {
  const [amount, increment, scale] = aligned(value, step);
  if (increment <= ZERO) throw new RangeError("El paso debe ser positivo.");
  let quotient = amount / increment;
  if (amount < ZERO && amount % increment !== ZERO) quotient -= ONE;
  return format({ coefficient: quotient * increment, scale });
}
