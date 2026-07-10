import {
  Wallet,
  TrendingUp,
  Compass,
  FlaskConical,
  Bot,
  GraduationCap,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Wallet,
    title: "Cartera en vivo",
    description:
      "Todas tus monedas en un solo lugar, valuadas en dólares y actualizadas al instante.",
  },
  {
    icon: TrendingUp,
    title: "Rendimientos claros",
    description:
      "Cuánto ganaste o perdiste, en qué período y por qué. Gráficos que se entienden de un vistazo.",
  },
  {
    icon: Compass,
    title: "Estrategias a tu medida",
    description:
      "Según tu perfil (conservador, moderado o arriesgado) te recomendamos estrategias y te explicamos cada una.",
  },
  {
    icon: FlaskConical,
    title: "Probá sin riesgo",
    description:
      "Backtesting: mirá cómo le habría ido a una estrategia con datos históricos reales antes de poner un peso.",
  },
  {
    icon: Bot,
    title: "Robot de operaciones",
    description:
      "Un bot que compra y vende por vos siguiendo la estrategia que elegiste, con límites que vos definís.",
  },
  {
    icon: GraduationCap,
    title: "Modo práctica",
    description:
      "Todo se puede probar primero con fondos ficticios en el entorno de prueba de Binance. Sin riesgo real.",
  },
];

export function Features() {
  return (
    <section id="funciones" className="relative py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_30%_50%,rgba(45,212,191,0.08),transparent_70%)]"
      />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Todo lo que necesitás para operar tranquilo
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Herramientas de nivel profesional, presentadas para personas
            normales.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="border-white/5 bg-white/[0.02] transition-colors hover:border-emerald-400/30"
            >
              <CardContent className="flex flex-col gap-3 pt-2">
                <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                  <feature.icon className="size-5 text-emerald-400" />
                </span>
                <h3 className="text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
