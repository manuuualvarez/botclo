import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ProfileQuiz } from "@/components/profile/profile-quiz";
import { getProfile } from "@/lib/profile";

export const metadata = {
  title: "Mi perfil de inversor",
};

export default async function PerfilPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const profile = await getProfile(userId);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold tracking-tight">
        Tu perfil de inversor
      </h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Cuatro preguntas, un minuto. Con esto te recomendamos estrategias que
        van con vos — no con el vecino.
      </p>
      <div className="mt-10">
        <ProfileQuiz initialProfile={profile} />
      </div>
    </div>
  );
}
