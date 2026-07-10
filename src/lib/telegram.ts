// Cliente mínimo de la Bot API de Telegram. El token es del bot del propio
// usuario (creado con @BotFather) y se guarda cifrado.

interface TelegramResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  html: string
): Promise<TelegramResult> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
        cache: "no-store",
      }
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;
    if (!res.ok || !body?.ok) {
      return { ok: false, error: body?.description ?? res.statusText };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "No pudimos comunicarnos con Telegram." };
  }
}

// Detecta el chat automáticamente: el usuario le manda cualquier mensaje a su
// bot y acá leemos getUpdates para encontrar ese chat.
export async function detectChatId(
  token: string
): Promise<{ chatId: string; name: string } | null> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?limit=100`,
    { cache: "no-store" }
  );
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: {
      message?: { chat: { id: number; first_name?: string; username?: string; title?: string } };
    }[];
  } | null;

  if (!body?.ok) {
    throw new Error(
      body?.description ??
        "Telegram rechazó el token. Revisá que lo hayas copiado completo."
    );
  }
  const chats = (body.result ?? [])
    .map((update) => update.message?.chat)
    .filter((chat): chat is NonNullable<typeof chat> => Boolean(chat));
  const last = chats[chats.length - 1];
  if (!last) return null;
  return {
    chatId: String(last.id),
    name: last.first_name ?? last.title ?? last.username ?? "tu chat",
  };
}
