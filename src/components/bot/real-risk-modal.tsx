"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// Modal de máximo riesgo legal: activación del robot con DINERO REAL.
// Requiere leer (scroll), marcar el checkbox y tipear ACEPTO. La confirmación
// queda registrada como aceptación `robot_real` con snapshot en el servidor.
export function RealRiskModal({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [checked, setChecked] = useState(false);
  const [typed, setTyped] = useState("");

  const canConfirm = scrolledToEnd && checked && typed.trim().toUpperCase() === "ACEPTO";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-400" />
            Vas a operar con dinero real
          </DialogTitle>
          <DialogDescription>Leé esto hasta el final.</DialogDescription>
        </DialogHeader>

        <div
          className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm leading-relaxed text-muted-foreground"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) {
              setScrolledToEnd(true);
            }
          }}
        >
          <ul className="flex flex-col gap-2.5">
            <li>
              El robot va a comprar y vender <strong>automáticamente</strong> en
              tu cuenta de Binance, a cualquier hora, sin pedirte confirmación
              operación por operación, siguiendo la estrategia y los parámetros{" "}
              <strong>que vos elegiste</strong>.
            </li>
            <li>
              <strong>Podés perder hasta la totalidad del presupuesto que le
              asignes.</strong> Las cripto son extremadamente volátiles y
              ninguna estrategia garantiza ganancias.
            </li>
            <li>
              Los resultados de backtesting y del modo práctica{" "}
              <strong>no predicen</strong> lo que va a pasar con dinero real.
            </li>
            <li>
              Fallas técnicas (nuestras, de internet o de Binance) pueden
              demorar o impedir operaciones, incluso stops de protección, y
              causarte pérdidas.
            </li>
            <li>
              Botclo es una herramienta de software:{" "}
              <strong>no te asesora ni decide por vos</strong>, y no garantiza
              ningún rendimiento. Sos el único responsable de tu configuración y
              de supervisar el robot.
            </li>
            <li>
              Podés pausar el robot cuando quieras, y tus fondos siempre están
              en tu cuenta de Binance, no en Botclo.
            </li>
          </ul>
          {!scrolledToEnd && (
            <p className="mt-3 text-center text-xs text-amber-300">
              ↓ Seguí leyendo hasta el final para poder continuar
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            disabled={!scrolledToEnd}
            className="mt-0.5"
          />
          <span className="text-sm text-muted-foreground">
            Leí y entiendo los riesgos. Acepto que{" "}
            <strong className="text-foreground">puedo perder todo el
            presupuesto asignado</strong> y que las operaciones del robot son mi
            exclusiva responsabilidad.
          </span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            Para confirmar, escribí <strong className="text-foreground">ACEPTO</strong>:
          </span>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="ACEPTO"
            disabled={!checked}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!canConfirm || isPending}
            onClick={onConfirm}
            className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            {isPending ? "Activando…" : "Activar robot con dinero real"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
