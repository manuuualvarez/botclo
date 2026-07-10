import Link from "next/link";
import { Compass } from "lucide-react";
import { site } from "@/config/site";

const docs = [
  { href: "/legal/terminos", label: "Términos y Condiciones" },
  { href: "/legal/privacidad", label: "Política de Privacidad" },
  { href: "/legal/riesgo", label: "Aviso de Riesgo" },
  { href: "/legal/regulatorio", label: "Aviso Regulatorio" },
];

export default function LegalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 sm:px-6">
      <Link href="/" className="mb-8 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-400/30">
          <Compass className="size-4.5 text-emerald-400" />
        </span>
        <span className="text-lg font-semibold">{site.name}</span>
      </Link>

      <nav className="mb-10 flex flex-wrap gap-x-4 gap-y-2 border-b border-white/5 pb-4 text-sm">
        {docs.map((doc) => (
          <Link
            key={doc.href}
            href={doc.href}
            className="text-muted-foreground transition-colors hover:text-emerald-400"
          >
            {doc.label}
          </Link>
        ))}
      </nav>

      <article className="prose-legal flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-foreground [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-4 [&_h3]:font-semibold [&_h3]:text-foreground [&_strong]:text-foreground [&_a]:text-emerald-400 [&_a]:underline [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5 [&_li]:list-disc">
        {children}
      </article>
    </div>
  );
}
