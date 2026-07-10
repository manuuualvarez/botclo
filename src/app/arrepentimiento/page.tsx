import Link from "next/link";
import { Compass, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LEGAL_HOLDER } from "@/config/legal";
import { site } from "@/config/site";

export const metadata = { title: "Botón de arrepentimiento" };

// Botón de arrepentimiento — obligatorio y de acceso directo desde la home
// (Resolución 424/2020 SCI, art. 34 Ley 24.240). No requiere estar logueado.
export default function ArrepentimientoPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-16 sm:px-6">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30">
          <Compass className="size-4.5 text-emerald-400" />
        </span>
        <span className="text-lg font-semibold">{site.name}</span>
      </Link>

      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
          <RotateCcw className="size-5 text-emerald-400" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight">
          Botón de arrepentimiento
        </h1>
      </div>

      <p className="mt-6 text-muted-foreground">
        Si contrataste una suscripción de {site.name}, tenés derecho a{" "}
        <strong className="text-foreground">arrepentirte dentro de los 10
        días corridos</strong> desde la contratación, sin dar explicaciones y
        sin ninguna penalidad, con <strong className="text-foreground">
        devolución total</strong> de lo que pagaste (art. 34 de la Ley 24.240 y
        arts. 1110 a 1116 del Código Civil y Comercial).
      </p>

      <Card className="mt-8 border-white/5 bg-white/[0.02]">
        <CardContent className="flex flex-col gap-4 pt-2">
          <h2 className="font-semibold">Cómo ejercerlo</h2>
          <div>
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Opción 1 — desde tu
              panel:</strong> entrá a «Mi plan» y tocá «Cancelar suscripción».
              Si estás dentro de los 10 días, se te reintegra el total.
            </p>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-3"
            >
              <Link href="/dashboard/plan">Ir a Mi plan</Link>
            </Button>
          </div>
          <div className="border-t border-white/5 pt-4">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Opción 2 — por
              correo:</strong> escribinos desde el mail de tu cuenta a{" "}
              <a
                href={`mailto:${LEGAL_HOLDER.emailSoporte}?subject=Arrepentimiento%20de%20suscripci%C3%B3n`}
                className="text-emerald-400 underline"
              >
                {LEGAL_HOLDER.emailSoporte}
              </a>{" "}
              indicando que querés arrepentirte de tu suscripción. Te
              confirmamos la baja y el reintegro por el mismo medio de pago.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground/70">
        El reintegro se cursa por el mismo medio de pago (MercadoPago) dentro de
        los plazos que apliquen. Este derecho corresponde a cada nueva
        contratación. Podés cancelar tu suscripción en cualquier momento (aun
        pasados los 10 días) desde «Mi plan», conservando el acceso hasta el fin
        del período ya pagado.
      </p>
    </main>
  );
}
