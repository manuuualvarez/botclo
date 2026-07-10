"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  RotateCcw,
  Shield,
  Scale,
  Rocket,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { profileInfo, quizQuestions } from "@/lib/quiz";
import { saveProfileAction } from "@/app/dashboard/perfil/actions";
import type { RiskProfile } from "@/lib/strategies/types";

const profileIcons: Record<RiskProfile, typeof Shield> = {
  conservador: Shield,
  moderado: Scale,
  arriesgado: Rocket,
};

function ProfileResult({
  profile,
  onRetake,
}: {
  profile: RiskProfile;
  onRetake: () => void;
}) {
  const info = profileInfo[profile];
  const Icon = profileIcons[profile];
  return (
    <Card className="border-emerald-400/20 bg-emerald-500/[0.04]">
      <CardContent className="flex flex-col items-start gap-4 pt-2">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
            <Icon className="size-6 text-emerald-400" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">Tu perfil de inversor</p>
            <p className="text-2xl font-bold">{info.nombre}</p>
          </div>
        </div>
        <p className="text-muted-foreground">{info.descripcion}</p>
        <div className="flex flex-wrap gap-3">
          <Button
            asChild
            className="bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            <Link href="/dashboard/estrategias">
              Ver estrategias para mi perfil
              <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" onClick={onRetake}>
            <RotateCcw className="size-4" />
            Volver a hacer el test
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfileQuiz({
  initialProfile,
}: {
  initialProfile: RiskProfile | null;
}) {
  const [profile, setProfile] = useState<RiskProfile | null>(initialProfile);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (profile) {
    return (
      <ProfileResult
        profile={profile}
        onRetake={() => {
          setProfile(null);
          setStep(0);
          setAnswers({});
        }}
      />
    );
  }

  const question = quizQuestions[step];
  const isLast = step === quizQuestions.length - 1;

  function pick(score: number) {
    const next = { ...answers, [question.key]: score };
    setAnswers(next);
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    startTransition(async () => {
      const result = await saveProfileAction(next);
      if (result.error) setError(result.error);
      else if (result.profile) setProfile(result.profile);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Badge variant="outline" className="shrink-0">
          Pregunta {step + 1} de {quizQuestions.length}
        </Badge>
        <Progress
          value={(step / quizQuestions.length) * 100}
          className="h-1.5"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <h2 className="text-2xl font-semibold">{question.pregunta}</h2>
        {question.ayuda && (
          <p className="mt-1 text-sm text-muted-foreground">{question.ayuda}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {question.opciones.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={isPending}
            onClick={() => pick(option.score)}
            className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4 text-left transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/[0.06] disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={step === 0 || isPending}
          onClick={() => setStep(step - 1)}
        >
          <ArrowLeft className="size-4" />
          Anterior
        </Button>
        {isPending && (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Calculando tu perfil…
          </span>
        )}
      </div>
    </div>
  );
}
