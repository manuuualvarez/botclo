"use client";

import { useState, useTransition } from "react";
import { Gift, Loader2, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { grantAction, revokeGrantAction } from "@/app/admin/actions";

export function GrantControls({
  userId,
  userLabel,
  hasGrant,
}: {
  userId: string;
  userLabel: string;
  hasGrant: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<string>("pro");
  const [duracion, setDuracion] = useState<string>("6");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (hasGrant) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await revokeGrantAction(userId);
          })
        }
      >
        <X className="size-4" />
        Revocar cortesía
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Gift className="size-4" />
          Dar cortesía
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cortesía para {userLabel}</DialogTitle>
          <DialogDescription>
            El usuario obtiene el plan sin pagar, hasta el vencimiento. Regla
            de la casa: preferí vencimiento a 6 meses renovable antes que
            «sin vencimiento».
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Plan</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="real">Botclo Real</SelectItem>
                <SelectItem value="pro">Botclo Pro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Duración</Label>
            <Select value={duracion} onValueChange={setDuracion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 meses</SelectItem>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
                <SelectItem value="0">Sin vencimiento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="motivo">Motivo (para tu registro)</Label>
            <Input
              id="motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: amigo early adopter"
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await grantAction({
                  userId,
                  plan,
                  months: duracion === "0" ? null : Number(duracion),
                  motivo: motivo || undefined,
                });
                if (result.error) setError(result.error);
                else setOpen(false);
              })
            }
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Otorgar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
