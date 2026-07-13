"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

// 404 propia: la default de Next expone el stack tecnológico y no ofrece
// ninguna salida. "Volver" usa el historial solo si existe; si el usuario
// cayó acá directo (link externo, marcador viejo), lo mandamos al inicio.
export default function NotFound() {
  const router = useRouter();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-24 text-center">
      <p className="text-7xl font-bold tracking-tight text-emerald-400/90">
        404
      </p>
      <h1 className="text-2xl font-semibold">Esta página no existe</h1>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        Puede que el enlace esté vencido o mal escrito. Tranquilo: si tenés
        robots andando, siguen trabajando como si nada.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button
          variant="outline"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push("/")
          }
        >
          <ArrowLeft className="size-4" />
          Volver
        </Button>
        <Button
          asChild
          className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
        >
          <Link href="/">
            <Compass className="size-4" />
            Ir a {site.name}
          </Link>
        </Button>
      </div>
    </main>
  );
}
