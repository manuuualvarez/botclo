import { Lock, Eye, SlidersHorizontal, FlaskConical } from "lucide-react";

const items = [
  {
    icon: Eye,
    title: "Solo lectura para empezar",
    description:
      "La clave que conectás al principio solo permite ver tu cartera. Nadie puede mover tu plata con ella.",
  },
  {
    icon: Lock,
    title: "Claves cifradas",
    description:
      "Tus claves de Binance se guardan cifradas con AES-256. Ni siquiera nosotros podemos leerlas en texto plano.",
  },
  {
    icon: SlidersHorizontal,
    title: "Vos ponés los límites",
    description:
      "Si activás el robot, definís cuánto puede operar como máximo. Lo podés pausar o desconectar cuando quieras.",
  },
  {
    icon: FlaskConical,
    title: "Primero en modo práctica",
    description:
      "Toda estrategia se prueba antes con fondos ficticios. Recién cuando la viste funcionar, decidís usarla en serio.",
  },
];

export function Security() {
  return (
    <section id="seguridad" className="relative py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div className="lg:sticky lg:top-28">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Tu plata queda donde está:{" "}
              <span className="text-emerald-400">en tu Binance</span>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              {`No somos un exchange ni custodiamos fondos. Nos conectamos a tu
              cuenta con los permisos que vos elegís, y nada más.`}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-white/5 bg-white/[0.02] p-6"
              >
                <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                  <item.icon className="size-5 text-emerald-400" />
                </span>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
