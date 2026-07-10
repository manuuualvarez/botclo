import { notFound } from "next/navigation";
import { PriceEditor } from "@/components/admin/price-editor";
import { PLAN_LIMITS } from "@/config/plans";
import { isAdmin } from "@/lib/admin";
import { getPlanPrices } from "@/lib/plan-prices";

export const metadata = {
  title: "Planes — Admin",
};

export default async function AdminPlanesPage() {
  if (!(await isAdmin())) notFound();

  const prices = await getPlanPrices();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Planes y precios
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Los precios se aplican al instante a los <strong>checkouts
          nuevos</strong> (no hay que crear productos en MercadoPago: cada
          pago se genera por API con el monto vigente). Las suscripciones ya
          activas mantienen su monto actual — actualizarlas requiere modificar
          cada preapproval en MP, una función que agregamos cuando haga falta
          el primer ajuste por inflación.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceEditor
          plan="real"
          nombre={PLAN_LIMITS.real.nombre}
          mensualInicial={prices.real.mensual}
          anualInicial={prices.real.anual}
        />
        <PriceEditor
          plan="pro"
          nombre={PLAN_LIMITS.pro.nombre}
          mensualInicial={prices.pro.mensual}
          anualInicial={prices.pro.anual}
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground/70">
        Los límites de cada plan (cantidad de robots, estrategias, modo real)
        son decisiones de producto y viven en el código
        (src/config/plans.ts) — cambiarlos requiere un deploy, a propósito.
        La justificación de los precios está en BUSINESS.md.
      </p>
    </div>
  );
}
