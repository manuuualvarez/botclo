import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { site } from "@/config/site";

export function Footer() {
  return (
    <footer className="relative">
      {/* CTA final */}
      <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/15 via-teal-500/10 to-transparent px-8 py-16 text-center">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Empezá hoy, sin poner un peso
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            Creá tu cuenta, conectá Binance en modo lectura y mirá tu cartera
            con otros ojos.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-8 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            <Link href="/sign-up">
              Crear mi cuenta
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <Separator className="bg-white/5" />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Image
              src="/botclo-mark.svg"
              alt=""
              width={24}
              height={24}
              className="size-6"
            />
            <span className="font-semibold">{site.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} {site.name}. Hecho en Argentina.
          </p>
        </div>

        {/* Enlaces legales obligatorios (Ley 24.240, Res. 424/2020 SCI) */}
        <nav className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Link
            href="/legal/terminos"
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            Términos y Condiciones
          </Link>
          <Link
            href="/legal/privacidad"
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            Política de Privacidad
          </Link>
          <Link
            href="/legal/riesgo"
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            Aviso de Riesgo
          </Link>
          <Link
            href="/legal/regulatorio"
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            Aviso Regulatorio
          </Link>
          <Link
            href="/arrepentimiento"
            className="rounded-md border border-white/15 px-2.5 py-1 font-medium text-foreground transition-colors hover:border-emerald-400/40"
          >
            Botón de arrepentimiento
          </Link>
          <a
            href="https://www.argentina.gob.ar/defensadelconsumidor"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            Defensa del Consumidor
          </a>
        </nav>

        <p className="mt-6 max-w-3xl text-xs leading-relaxed text-muted-foreground/70">
          <strong className="text-muted-foreground">{site.name}</strong> es una
          herramienta de software operada por Manuel Ignacio Álvarez, Argentina.
          Botclo <strong className="text-muted-foreground">no brinda
          asesoramiento financiero</strong>,{" "}
          <strong className="text-muted-foreground">no custodia fondos</strong>{" "}
          (tus criptoactivos permanecen en tu cuenta de Binance) y{" "}
          <strong className="text-muted-foreground">no garantiza
          rendimientos</strong>. Invertir en criptoactivos implica riesgo de{" "}
          <strong className="text-muted-foreground">pérdida total</strong>. Los
          rendimientos pasados no garantizan resultados futuros. Botclo no es un
          agente registrado ante la CNV ni una entidad supervisada por el BCRA.
        </p>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground/70">
          La Agencia de Acceso a la Información Pública, órgano de control de la
          Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las
          normas de protección de datos personales —{" "}
          <a
            href="https://www.argentina.gob.ar/aaip"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-emerald-400"
          >
            argentina.gob.ar/aaip
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
