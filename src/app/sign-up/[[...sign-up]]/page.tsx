import Link from "next/link";
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <SignUp />
      <p className="max-w-sm px-6 text-center text-xs leading-relaxed text-muted-foreground">
        Al crear tu cuenta aceptás los{" "}
        <Link href="/legal/terminos" className="text-emerald-400 underline">
          Términos y Condiciones
        </Link>
        , la{" "}
        <Link href="/legal/privacidad" className="text-emerald-400 underline">
          Política de Privacidad
        </Link>{" "}
        y el{" "}
        <Link href="/legal/riesgo" className="text-emerald-400 underline">
          Aviso de Riesgo
        </Link>
        . Botclo es una herramienta de software: <strong>no brinda
        asesoramiento financiero</strong> y <strong>no garantiza
        rendimientos</strong>. Tus fondos quedan siempre en tu cuenta de
        Binance.
      </p>
    </div>
  );
}
