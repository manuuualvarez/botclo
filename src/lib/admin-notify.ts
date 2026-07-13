import { clerkClient } from "@clerk/nextjs/server";
import nodemailer from "nodemailer";
import { sendTelegramMessage } from "@/lib/telegram";
import { getTelegramCredentials } from "@/lib/telegram-settings";

// Notificaciones OPERATIVAS para los ADMINISTRADORES — no confundir con las
// notificaciones al usuario final (esas van por el Telegram que cada usuario
// configuró para su robot). Acá el destinatario es Manuel:
// - Telegram: se resuelven los admins desde ADMIN_EMAILS y se usa el bot que
//   cada admin ya configuró en SU cuenta de Botclo (telegram_settings).
// - Email: SMTP opcional vía ADMIN_SMTP_* (sin configurar, se omite en
//   silencio y queda solo Telegram).
// Nunca rompen el flujo que las dispara.

async function adminUserIds(): Promise<string[]> {
  const emails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) return [];
  const client = await clerkClient();
  const { data } = await client.users.getUserList({ emailAddress: emails });
  return data.map((u) => u.id);
}

async function notifyAdminsTelegram(text: string): Promise<void> {
  const ids = await adminUserIds();
  for (const userId of ids) {
    try {
      const creds = await getTelegramCredentials(userId);
      if (!creds) continue;
      await sendTelegramMessage(creds.token, creds.chatId, text);
    } catch {
      // un admin sin Telegram no corta el aviso a los demás
    }
  }
}

async function notifyAdminsEmail(subject: string, text: string): Promise<void> {
  const host = process.env.ADMIN_SMTP_HOST;
  const user = process.env.ADMIN_SMTP_USER;
  const pass = process.env.ADMIN_SMTP_PASS;
  const to =
    process.env.ADMIN_NOTIFY_EMAIL ??
    (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim();
  if (!host || !user || !pass || !to) return; // sin SMTP configurado, se omite

  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.ADMIN_SMTP_PORT ?? 587),
    secure: Number(process.env.ADMIN_SMTP_PORT ?? 587) === 465,
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `"Botclo" <${user}>`,
    to,
    subject,
    // el texto compartido usa tags de Telegram (<b>): al mail va plano
    text: text.replace(/<[^>]+>/g, ""),
  });
}

// Dispara Telegram y email en paralelo; los errores se tragan a propósito
// (una notificación caída jamás debe romper una cancelación o un pago).
export async function notifyAdmins(
  subject: string,
  text: string
): Promise<void> {
  await Promise.allSettled([
    notifyAdminsTelegram(text),
    notifyAdminsEmail(subject, text),
  ]);
}
