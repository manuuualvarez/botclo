import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { legalAcceptances } from "@/db/schema";
import { LEGAL_VERSIONS, type LegalDocument } from "@/config/legal";

// Registra una aceptación legal con IP y user-agent (prueba del consentimiento).
export async function recordAcceptance(
  userId: string,
  document: LegalDocument,
  snapshot?: unknown
): Promise<void> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  await db.insert(legalAcceptances).values({
    userId,
    document,
    version: LEGAL_VERSIONS[document],
    ip,
    userAgent: h.get("user-agent") ?? null,
    snapshot: snapshot ?? null,
  });
}

// ¿El usuario aceptó la versión vigente de un documento?
export async function hasAccepted(
  userId: string,
  document: LegalDocument
): Promise<boolean> {
  const row = await db.query.legalAcceptances.findFirst({
    where: and(
      eq(legalAcceptances.userId, userId),
      eq(legalAcceptances.document, document),
      eq(legalAcceptances.version, LEGAL_VERSIONS[document])
    ),
    columns: { id: true },
  });
  return row !== undefined;
}
