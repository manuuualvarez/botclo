import Link from "next/link";
import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { isAdmin } from "@/lib/admin";

const links = [
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#funciones", label: "Funciones" },
  { href: "/#seguridad", label: "Seguridad" },
];

export async function Navbar() {
  const admin = await isAdmin();
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/botclo-mark.svg"
            alt=""
            width={32}
            height={32}
            className="size-8"
          />
          <span className="text-lg font-semibold tracking-tight">
            {site.name}
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <SignInButton>
              <Button variant="ghost">Ingresar</Button>
            </SignInButton>
            <SignUpButton>
              <Button className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400">
                Crear cuenta
              </Button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            {admin && (
              <Button asChild variant="ghost" className="text-violet-300">
                <Link href="/admin">
                  <ShieldCheck className="size-4" />
                  Admin
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link href="/dashboard">Mi panel</Link>
            </Button>
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
