"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Info,
  Loader2,
  Pause,
  PauseCircle,
  Play,
  Trash2,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  deleteBotAction,
  runMyBotNowAction,
  setBotStatusAction,
} from "@/app/dashboard/robot/actions";

export function BotControls({
  botId,
  status,
  nativeProtection,
}: {
  botId: number;
  status: string;
  nativeProtection: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const active = status === "active";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setInfo(null);
              try {
                const result = await runMyBotNowAction(botId);
                if (result.error) setError(result.error);
                else if (result.message) setInfo(result.message);
              } catch { setError("No pudimos confirmar la revisión. Recargá la página antes de volver a intentar."); }
            })
          }
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          Ejecutar ahora
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setInfo(null);
              try {
                const result = await setBotStatusAction(botId, active ? "paused" : "active");
                if (result.error) setError(result.error);
              } catch { setError("No pudimos confirmar el cambio de estado. Recargá la página."); }
            })
          }
        >
          {active ? (
            <>
              <Pause className="size-4" />
              Pausar
            </>
          ) : (
            <>
              <Play className="size-4" />
              Reanudar
            </>
          )}
        </Button>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={isPending}>
              <Trash2 className="size-4" />
              Eliminar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Eliminar este robot?</DialogTitle>
              <DialogDescription>
                Solo podés eliminarlo cuando no tenga posiciones, órdenes de
                protección ni operaciones pendientes de conciliar. Conservamos
                su historial; cuando corresponda, la configuración queda archivada.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    setInfo(null);
                    try {
                      const result = await deleteBotAction(botId);
                      if (result.error) setError(result.error);
                      if (result.ok) setDeleteOpen(false);
                    } catch { setError("No pudimos confirmar la eliminación. Recargá la página."); }
                  })
                }
              >
                Sí, eliminar
              </Button>
            </DialogFooter>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </DialogContent>
        </Dialog>
      </div>

      {!active && (
        <Alert>
          <PauseCircle className="size-4" />
          <AlertDescription>
            {nativeProtection
              ? "Robot en pausa: no toma nuevas decisiones. Pausar no cancela la última orden de stop confirmada en Binance; puede ejecutarse aunque no reanudes el robot."
              : "Robot en pausa: no toma nuevas decisiones y no tiene un stop confirmado en Binance. La protección local del sistema anterior tampoco opera mientras está pausado."}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {info && (
        <Alert>
          <Info className="size-4" />
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
