import { Navbar } from "@/components/landing/navbar";
import { DashboardNav } from "@/components/dashboard/nav";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-24 sm:px-6">
        <DashboardNav />
        <div className="pt-8">{children}</div>
      </main>
    </>
  );
}
