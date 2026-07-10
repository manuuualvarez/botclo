"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

// El canvas 3D solo tiene sentido en el navegador: se carga sin SSR y con
// un placeholder para no bloquear el render inicial de la página.
const HeroCanvas = dynamic(() => import("@/components/three/hero-canvas"), {
  ssr: false,
  loading: () => (
    <div className="size-full animate-pulse rounded-full bg-emerald-500/5" />
  ),
});

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-16">
      {/* Fondos: gradiente radial esmeralda + grilla sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_70%_35%,rgba(16,185,129,0.14),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,black,transparent)]"
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
        <div className="flex flex-col items-start gap-6">
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-emerald-300"
          >
            <Sparkles className="size-3.5" />
            Pensado para gente que recién empieza
          </Badge>

          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Tu plata en cripto,{" "}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-400 bg-clip-text text-transparent">
              explicada en criollo
            </span>
          </h1>

          <p className="max-w-xl text-lg text-muted-foreground">
            {site.name} se conecta a tu cuenta de Binance y te muestra cuánto
            tenés, cómo viene rindiendo y qué estrategia le conviene a tu
            perfil. Todo con guías paso a paso, sin palabras raras.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <Button
              asChild
              size="lg"
              className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            >
              <Link href="/sign-up">
                Empezar gratis
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#como-funciona">Ver cómo funciona</a>
            </Button>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-emerald-400" />
            Tu plata nunca sale de Binance. Nosotros solo la leemos.
          </p>
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-md lg:max-w-lg">
          <HeroCanvas />
        </div>
      </div>
    </section>
  );
}
