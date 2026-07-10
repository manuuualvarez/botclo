// Identidad de la app centralizada: cambiar el nombre/tagline acá
// se refleja en toda la UI y en los metadatos.
export const site = {
  name: "Botclo",
  tagline: "Tus robots de inversión en cripto",
  description:
    "Conectá tu cuenta de Binance y poné robots a trabajar por vos: cartera, rendimientos y estrategias explicadas paso a paso, sin lenguaje técnico.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
