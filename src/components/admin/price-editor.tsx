"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePlanPricesAction } from "@/app/admin/actions";

export function PriceEditor({
  plan,
  nombre,
  mensualInicial,
  anualInicial,
}: {
  plan: "real" | "pro";
  nombre: string;
  mensualInicial: number;
  anualInicial: number;
}) {
  const [mensual, setMensual] = useState(String(mensualInicial));
  const [anual, setAnual] = useState(String(anualInicial));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <h2 className="text-lg font-semibold">{nombre}</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${plan}-mensual`}>Mensual (ARS)</Label>
            <Input
              id={`${plan}-mensual`}
              type="number"
              min={1000}
              value={mensual}
              onChange={(e) => {
                setMensual(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${plan}-anual`}>Anual (ARS)</Label>
            <Input
              id={`${plan}-anual`}
              type="number"
              min={1000}
              value={anual}
              onChange={(e) => {
                setAnual(e.target.value);
                setSaved(false);
              }}
            />
            {Number(mensual) > 0 && (
              <p className="text-xs text-muted-foreground">
                Equivale a {(Number(anual) / Number(mensual)).toFixed(1)} meses
                (la referencia del modelo: 10 de 12).
              </p>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <Button
          className="mt-4"
          variant="outline"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await updatePlanPricesAction({
                plan,
                mensual,
                anual,
              });
              if (result.error) setError(result.error);
              else setSaved(true);
            })
          }
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <>
              <CheckCircle2 className="size-4 text-emerald-400" />
              Guardado
            </>
          ) : (
            "Guardar precios"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
