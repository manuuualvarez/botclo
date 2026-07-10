"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  cancelSubscriptionAction,
  startCheckoutAction,
} from "@/app/dashboard/plan/actions";

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

export function CheckoutButtons({
  plan,
  mensual,
  anual,
  destacado,
}: {
  plan: "real" | "pro";
  mensual: number;
  anual: number;
  destacado?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [acepta, setAcepta] = useState(false);
  const [isPending, startTransition] = useTransition();

  function go(tipo: "mensual" | "anual") {
    if (!acepta) {
      setError(
        "Marcá la casilla para continuar: aceptás la renovación automática y conocés tu derecho de arrepentimiento."
      );
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await startCheckoutAction({ plan, tipo });
      if (result.error) setError(result.error);
      else if (result.url) window.location.href = result.url;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="mb-1 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Checkbox
          checked={acepta}
          onCheckedChange={(v) => setAcepta(v === true)}
          className="mt-0.5"
        />
        <span>
          Acepto la contratación con <strong>renovación automática</strong> y
          conozco mi{" "}
          <Link href="/arrepentimiento" className="text-emerald-400 underline">
            derecho de arrepentimiento
          </Link>{" "}
          dentro de los 10 días. El pago lo procesa MercadoPago.
        </span>
      </label>
      <Button
        disabled={isPending}
        onClick={() => go("mensual")}
        className={
          destacado
            ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            : undefined
        }
        variant={destacado ? "default" : "outline"}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <>Mensual · {ars.format(mensual)}</>
        )}
      </Button>
      <Button
        variant="outline"
        disabled={isPending}
        onClick={() => go("anual")}
        className="h-auto flex-col gap-0.5 border-emerald-400/30 py-2"
      >
        <span>Anual · {ars.format(anual)}</span>
        <span className="text-xs font-normal text-emerald-400">
          2 meses gratis vs. pagar mensual
        </span>
      </Button>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function CancelSubscriptionButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          Cancelar suscripción
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Cancelar tu suscripción?</DialogTitle>
          <DialogDescription>
            Mantenés el acceso hasta el final del período ya pagado. Tus
            robots, configuración e historial se conservan; si tenés
            posiciones abiertas, sus stops siguen funcionando. Podés volver
            cuando quieras.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Volver
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await cancelSubscriptionAction();
                if (result.error) setError(result.error);
                else setOpen(false);
              })
            }
          >
            {isPending ? "Cancelando…" : "Sí, cancelar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
