import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, ExternalLink, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectForm } from "@/components/connect/connect-form";
import { hasCredentials } from "@/lib/binance/credentials";
import { isTestnet } from "@/lib/binance/client";

export const metadata = {
  title: "Conectar Binance",
};

const testnetSteps = [
  {
    title: "Entrá al entorno de práctica de Binance",
    body: (
      <>
        Abrí{" "}
        <a
          href="https://testnet.binance.vision"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-medium text-emerald-400 underline underline-offset-4"
        >
          testnet.binance.vision
          <ExternalLink className="size-3.5" />
        </a>{" "}
        e iniciá sesión con tu cuenta de GitHub (si no tenés una, se crea
        gratis en un minuto). Este entorno usa fondos ficticios: nada de lo que
        pase acá toca plata real.
      </>
    ),
  },
  {
    title: "Generá tu clave (¡la de tipo HMAC!)",
    body: (
      <>
        Una vez adentro vas a ver dos botones. Tocá{" "}
        <strong>«Generate HMAC_SHA256 Key»</strong> — ojo:{" "}
        <strong>no</strong> uses «Register RSA Key», porque ese tipo de clave
        no tiene Secret Key y no funciona acá. Escribí un nombre para
        identificarla (por ejemplo, <em>Botclo</em>) y confirmá.
      </>
    ),
  },
  {
    title: "Copiá y pegá las dos claves",
    body: (
      <>
        Binance te va a mostrar dos códigos: la <strong>API Key</strong> y la{" "}
        <strong>Secret Key</strong>. Copialos y pegalos en el formulario de
        acá abajo. Ojo: la Secret Key se muestra <strong>una sola vez</strong>;
        si la perdés, generá una clave nueva y listo.
      </>
    ),
  },
];

const mainnetSteps = [
  {
    title: "Abrí la gestión de API en Binance",
    body: (
      <>
        En la app o web de Binance, tocá tu <strong>perfil</strong> y entrá a{" "}
        <strong>«Gestión de API»</strong>. Elegí{" "}
        <strong>«Crear API» → «Generada por el sistema»</strong> y ponele un
        nombre (por ejemplo, <em>Botclo</em>).
      </>
    ),
  },
  {
    title: "Elegí los permisos según lo que quieras hacer",
    body: (
      <>
        <span className="mb-1.5 block">
          — ¿Solo mirar tu cartera y análisis? Dejá marcado únicamente{" "}
          <strong>«Habilitar lectura»</strong>.
        </span>
        <span className="mb-1.5 block">
          — ¿Vas a usar el robot? Marcá también{" "}
          <strong>«Habilitar trading de spot y de margen»</strong> (tranquilo:
          el robot solo opera spot, jamás usa margen ni apalancamiento).
        </span>
        <span className="block">
          En ningún caso actives <strong>«Habilitar retiros»</strong>: sin ese
          permiso, nadie puede sacar tu plata de Binance con estas claves,
          pase lo que pase. Si Binance te ofrece restringir la clave por IP,
          mejor todavía.
        </span>
      </>
    ),
  },
  {
    title: "Copiá y pegá las dos claves",
    body: (
      <>
        Copiá la <strong>API Key</strong> y la <strong>Secret Key</strong> y
        pegalas en el formulario. La Secret Key se muestra una sola vez.
      </>
    ),
  },
];

export default async function ConectarPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (await hasCredentials(userId)) redirect("/dashboard");

  const testnet = isTestnet();
  const steps = testnet ? testnetSteps : mainnetSteps;

  return (
    <>
      <div className="mx-auto w-full max-w-3xl">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Volver a mi panel
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Conectá tu Binance
          </h1>
          {testnet && (
            <Badge
              variant="outline"
              className="gap-1.5 border-amber-400/30 bg-amber-500/10 text-amber-300"
            >
              <FlaskConical className="size-3.5" />
              Modo práctica
            </Badge>
          )}
        </div>
        <p className="mt-3 text-lg text-muted-foreground">
          Son tres pasos y no toma más de cinco minutos. Te guiamos uno por
          uno.
        </p>

        <ol className="mt-10 flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title}>
              <Card className="border-white/5 bg-white/[0.02]">
                <CardContent className="flex gap-4 pt-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-sm font-bold text-emerald-400 ring-1 ring-emerald-400/25">
                    {index + 1}
                  </span>
                  <div>
                    <h2 className="font-semibold">{step.title}</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {step.body}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        <Card className="mt-8 border-emerald-400/20 bg-emerald-500/[0.04]">
          <CardContent className="pt-2">
            <h2 className="mb-5 text-lg font-semibold">Pegá tus claves acá</h2>
            <ConnectForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
