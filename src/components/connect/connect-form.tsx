"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  connectBinanceAction,
  type ConnectState,
} from "@/app/dashboard/conectar/actions";

const initialState: ConnectState = {};

export function ConnectForm() {
  const [state, formAction, isPending] = useActionState(
    connectBinanceAction,
    initialState
  );
  const [acepta, setAcepta] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>No pudimos conectar tu cuenta</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* Aviso siempre visible sobre permisos de la key */}
      <Alert className="border-amber-400/30 bg-amber-500/[0.06] text-amber-200">
        <ShieldCheck className="size-4 !text-amber-300" />
        <AlertTitle>Creá tu API key SIN permiso de retiro</AlertTitle>
        <AlertDescription className="text-amber-200/80">
          Botclo solo necesita permisos de <strong>lectura</strong> y{" "}
          <strong>trading spot</strong>. Nunca actives «Enable Withdrawals»:
          así, ni Botclo ni nadie que acceda a la clave puede sacar fondos de tu
          cuenta. Si detectamos que la clave tiene permiso de retiro, la
          rechazamos por tu seguridad.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiKey">API Key</Label>
        <Input
          id="apiKey"
          name="apiKey"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Pegá acá tu API Key"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="apiSecret">Secret Key (clave secreta)</Label>
        <Input
          id="apiSecret"
          name="apiSecret"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="Pegá acá tu Secret Key"
        />
      </div>

      {/* Mandato/autorización expresa (art. 1319 CCyC) + titularidad */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <Checkbox
          name="acepta"
          checked={acepta}
          onCheckedChange={(v) => setAcepta(v === true)}
          className="mt-0.5"
        />
        <span className="text-xs leading-relaxed text-muted-foreground">
          Confirmo que esta API key es de <strong>mi propia cuenta</strong> de
          Binance, que <strong>no tiene permiso de retiro</strong>, y{" "}
          <strong>autorizo a Botclo a enviar a Binance órdenes de compra y
          venta spot en mi cuenta únicamente según las estrategias que yo
          configure y active</strong>. Entiendo que puedo revocar esta
          autorización cuando quiera.
        </span>
      </label>

      <Button
        type="submit"
        disabled={isPending || !acepta}
        className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Verificando con Binance…
          </>
        ) : (
          "Conectar mi cuenta"
        )}
      </Button>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
        Antes de guardar nada probamos que las claves funcionen y que no tengan
        permiso de retiro. Se almacenan cifradas (AES-256) y podés
        desconectarlas cuando quieras desde tu panel.
      </p>
    </form>
  );
}
