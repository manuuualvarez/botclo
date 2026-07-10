import type { RiskProfile } from "@/lib/strategies/types";

// Cuestionario de perfil de inversor. Datos puros (client-safe).

export interface QuizOption {
  label: string;
  score: number;
}

export interface QuizQuestion {
  key: string;
  pregunta: string;
  ayuda?: string;
  opciones: QuizOption[];
}

export const quizQuestions: QuizQuestion[] = [
  {
    key: "experiencia",
    pregunta: "¿Cuánta experiencia tenés invirtiendo?",
    opciones: [
      { label: "Ninguna, recién arranco", score: 0 },
      { label: "Algo: plazo fijo, dólar, algún fondo", score: 1 },
      { label: "Bastante: ya operé acciones o cripto", score: 2 },
    ],
  },
  {
    key: "tolerancia",
    pregunta: "Si tu cartera cae 20% en una semana, ¿qué hacés?",
    ayuda: "En cripto, caídas así pasan de verdad. Sé honesto.",
    opciones: [
      { label: "Vendo todo, no duermo tranquilo", score: 0 },
      { label: "Aguanto y espero que se recupere", score: 1 },
      { label: "Aprovecho y compro más barato", score: 2 },
    ],
  },
  {
    key: "horizonte",
    pregunta: "¿Para cuándo pensás necesitar esta plata?",
    opciones: [
      { label: "En menos de un año", score: 0 },
      { label: "En uno a tres años", score: 1 },
      { label: "En más de tres años, no la necesito ya", score: 2 },
    ],
  },
  {
    key: "objetivo",
    pregunta: "¿Qué buscás con tus inversiones?",
    opciones: [
      { label: "Proteger lo que tengo de la inflación", score: 0 },
      { label: "Crecer de a poco pero seguro", score: 1 },
      { label: "Maximizar la ganancia, acepto el riesgo", score: 2 },
    ],
  },
];

export function scoreToProfile(totalScore: number): RiskProfile {
  if (totalScore <= 2) return "conservador";
  if (totalScore <= 5) return "moderado";
  return "arriesgado";
}

export const profileInfo: Record<
  RiskProfile,
  { nombre: string; descripcion: string }
> = {
  conservador: {
    nombre: "Conservador",
    descripcion:
      "Preferís dormir tranquilo antes que ganar más. Lo tuyo son las estrategias simples y de largo plazo, como la compra periódica.",
  },
  moderado: {
    nombre: "Moderado",
    descripcion:
      "Aceptás algo de vaivén a cambio de mejores rendimientos. Podés combinar compra periódica con estrategias que siguen la tendencia.",
  },
  arriesgado: {
    nombre: "Arriesgado",
    descripcion:
      "Vas por el máximo rendimiento y bancás la volatilidad. Las estrategias activas son para vos — siempre probadas primero en el simulador.",
  },
};
