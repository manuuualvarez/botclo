"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  Info,
  Loader2,
  Pause,
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
}: {
  botId: number;
  status: string;
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
              const result = await runMyBotNowAction(botId);
              if (result.error) setError(result.error);
              else if (result.message) setInfo(result.message);
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
              await setBotStatusAction(botId, active ? "paused" : "active");
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
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <Trash2 className="size-4" />
              Eliminar
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>¿Eliminar este robot?</DialogTitle>
              <DialogDescription>
                El robot deja de operar y se borra su configuración. Lo que ya
                compró queda en tu cuenta de Binance (no vendemos nada al
                eliminarlo) y el historial de operaciones se conserva.
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
                    await deleteBotAction(botId);
                    setDeleteOpen(false);
                  })
                }
              >
                Sí, eliminar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
