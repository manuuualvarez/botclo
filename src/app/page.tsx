import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { Steps } from "@/components/landing/steps";
import { Features } from "@/components/landing/features";
import { Security } from "@/components/landing/security";
import { Footer } from "@/components/landing/footer";

export default function Home() {
  return (
    <main className="flex-1">
      <Navbar />
      <Hero />
      <Steps />
      <Features />
      <Security />
      <Footer />
    </main>
  );
}
