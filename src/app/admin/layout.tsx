import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/landing/navbar";
import { isAdmin } from "@/lib/admin";
import { AdminNav } from "@/components/admin/nav";

// Todo /admin exige rol admin. Para el resto de los usuarios la sección
// directamente no existe (404), sin filtrar que hay algo ahí.
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await isAdmin())) notFound();

  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-24 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-400/30">
              <ShieldCheck className="size-4.5 text-violet-400" />
            </span>
            <span className="text-lg font-semibold">Administración</span>
          </Link>
          <Badge
            variant="outline"
            className="border-violet-400/30 bg-violet-500/10 text-violet-300"
          >
            Solo admins
          </Badge>
        </div>
        <AdminNav />
        <div className="pt-8">{children}</div>
      </main>
    </>
  );
}
