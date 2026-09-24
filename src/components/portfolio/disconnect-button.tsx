"use client";

import { useState, useTransition } from "react";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { disconnectBinanceAction } from "@/app/dashboard/actions";

export function DisconnectButton() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setError(null); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <Unplug className="size-4" />
          Desconectar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Desconectar tu cuenta de Binance?</DialogTitle>
          <DialogDescription>
            Vamos a borrar tus claves de nuestra base de datos y vas a dejar de
            ver tu cartera acá. Tu cuenta de Binance no se toca: podés volver a
            conectarla cuando quieras. Si algún robot tiene una posición,
            protección u operación pendiente, primero hay que conciliarla.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                try {
                  const result = await disconnectBinanceAction();
                  if (result.error) setError(result.error);
                  if (result.ok) setOpen(false);
                } catch { setError("No pudimos confirmar la desconexión. Recargá la página."); }
              })
            }
          >
            {isPending ? "Desconectando…" : "Sí, desconectar"}
          </Button>
        </DialogFooter>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
