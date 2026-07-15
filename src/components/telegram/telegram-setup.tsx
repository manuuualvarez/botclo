"use client";

import { useState, useTransition } from "react";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Send,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  deleteTelegramAction,
  detectChatIdAction,
  saveTelegramAction,
  sendTestTelegramAction,
  setTelegramCandleReportsAction,
  setTelegramEnabledAction,
} from "@/app/dashboard/robot/telegram-actions";

interface Props {
  configured: {
    chatId: string;
    enabled: boolean;
    candleReports: boolean;
  } | null;
}

const guideSteps = [
  <>
    En Telegram, buscá <strong>@BotFather</strong> (el bot oficial con tilde
    azul) y mandale <code>/newbot</code>. Elegí un nombre (ej:{" "}
    <em>Avisos Botclo</em>) y un usuario que termine en <code>bot</code> (ej:{" "}
    <em>avisos_botclo_bot</em>).
  </>,
  <>
    BotFather te va a responder con un <strong>token</strong> (algo como{" "}
    <code>123456789:AAH…</code>). Copialo.
  </>,
  <>
    Abrí el chat con <strong>tu bot recién creado</strong> y mandale cualquier
    mensaje (un «hola» alcanza). Esto nos permite detectar tu chat
    automáticamente.
  </>,
  <>
    Pegá el token acá abajo, tocá <strong>«Detectar mi chat»</strong> y
    después <strong>«Guardar»</strong>. Te llega un mensaje de bienvenida al
    toque.
  </>,
];

export function TelegramSetup({ configured }: Props) {
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [chatName, setChatName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (configured) {
    return (
      <Card className="border-white/5 bg-white/[0.02]">
        <CardContent className="pt-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/25">
                <BellRing className="size-5 text-emerald-400" />
              </span>
              <div>
                <h2 className="font-semibold">Avisos por Telegram</h2>
                <p className="text-sm text-muted-foreground">
                  Conectado al chat {configured.chatId}. Te avisamos cada
                  compra y venta del robot, indicando si es práctica o dinero
                  real.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="mr-2 flex items-center gap-2">
                <Switch
                  id="tg-enabled"
                  checked={configured.enabled}
                  onCheckedChange={(v) =>
                    startTransition(() => setTelegramEnabledAction(v))
                  }
                />
                <Label htmlFor="tg-enabled" className="text-sm">
                  {configured.enabled ? "Activado" : "Pausado"}
                </Label>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    setNotice(null);
                    const r = await sendTestTelegramAction();
                    if (r.error) setError(r.error);
                    else setNotice("Mensaje de prueba enviado. Mirá tu Telegram.");
                  })
                }
              >
                <Send className="size-4" />
                Probar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={isPending}
                onClick={() => startTransition(() => deleteTelegramAction())}
              >
                <Trash2 className="size-4" />
                Quitar
              </Button>
            </div>
          </div>
          <div className="mt-4 flex items-start justify-between gap-4 rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <div>
              <Label htmlFor="tg-candle-reports" className="text-sm">
                Parte de cada revisión
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Además de las compras y ventas, te contamos qué vio y qué
                decidió el robot cada vez que cierra una vela — la prueba de
                que está vivo aunque no opere. Según la estrategia puede ser
                un mensaje por hora.
              </p>
            </div>
            <Switch
              id="tg-candle-reports"
              checked={configured.candleReports}
              onCheckedChange={(v) =>
                startTransition(() => setTelegramCandleReportsAction(v))
              }
            />
          </div>
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="size-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <p className="mt-4 flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="size-4" />
              {notice}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-white/5 bg-white/[0.02]">
      <CardContent className="pt-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <BellRing className="size-5 text-emerald-400" />
          Avisos por Telegram (opcional)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Recibí un mensaje en tu Telegram cada vez que el robot compre o
          venda. Cuatro pasos:
        </p>

        <ol className="mt-4 flex flex-col gap-3">
          {guideSteps.map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-400 ring-1 ring-emerald-400/25">
                {index + 1}
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {step}
              </p>
            </li>
          ))}
        </ol>
        <a
          href="https://t.me/BotFather"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-400 underline underline-offset-4"
        >
          Abrir @BotFather en Telegram
          <ExternalLink className="size-3.5" />
        </a>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="tg-token">Token de tu bot</Label>
            <Input
              id="tg-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456789:AAH…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Tu chat</Label>
            <div className="flex gap-2">
              <Input
                value={chatName ? `${chatName} (${chatId})` : ""}
                readOnly
                placeholder="Se detecta automáticamente"
              />
              <Button
                type="button"
                variant="outline"
                disabled={isPending || !token.trim()}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const r = await detectChatIdAction({ token });
                    if (r.error) setError(r.error);
                    else if (r.chatId) {
                      setChatId(r.chatId);
                      setChatName(r.chatName ?? "tu chat");
                    }
                  })
                }
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Detectar mi chat"
                )}
              </Button>
            </div>
          </div>
        </div>

        <Button
          className="mt-5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          disabled={isPending || !token.trim() || !chatId}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const r = await saveTelegramAction({ token, chatId });
              if (r.error) setError(r.error);
            })
          }
        >
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Guardando…
            </>
          ) : (
            "Guardar y recibir bienvenida"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
