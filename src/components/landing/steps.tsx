import { UserPlus, KeyRound, LineChart, Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const steps = [
  {
    icon: UserPlus,
    title: "Creá tu cuenta",
    description:
      "Registrate con tu mail o tu cuenta de Google en menos de un minuto. Sin tarjetas ni datos bancarios.",
  },
  {
    icon: KeyRound,
    title: "Conectá tu Binance",
    description:
      "Te guiamos pantalla por pantalla para crear una clave de solo lectura. Vos siempre tenés el control.",
  },
  {
    icon: LineChart,
    title: "Mirá tu cartera",
    description:
      "Vas a ver cuánto tenés, en qué monedas y cómo viene rindiendo, con explicaciones en lenguaje simple.",
  },
  {
    icon: Bot,
    title: "Activá tu estrategia",
    description:
      "Probá estrategias en modo práctica con plata ficticia y, cuando estés seguro, activalas de verdad.",
  },
];

export function Steps() {
  return (
    <section id="como-funciona" className="relative py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Cuatro pasos, cero vueltas
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            No hace falta saber de trading ni de tecnología. La app te
            acompaña en cada paso.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <Card
              key={step.title}
              className="relative border-white/5 bg-white/[0.02] transition-colors hover:border-emerald-400/30"
            >
              <CardContent className="flex flex-col gap-4 pt-2">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                    <step.icon className="size-5 text-emerald-400" />
                  </span>
                  <span className="text-4xl font-bold text-white/10">
                    {index + 1}
                  </span>
                </div>
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
