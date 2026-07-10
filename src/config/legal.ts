// Versiones vigentes de los documentos legales. Si cambia una versión de
// tos/privacy/risk, el gate del dashboard fuerza re-aceptación.
export const LEGAL_VERSIONS = {
  tos: "1.0",
  privacy: "1.0",
  risk: "1.0",
  binance_connect: "1.0",
  robot_real: "1.0",
} as const;

export type LegalDocument = keyof typeof LEGAL_VERSIONS;

// Datos del titular — completar con los reales antes de publicar.
export const LEGAL_HOLDER = {
  nombre: "Manuel Ignacio Álvarez",
  cuit: "[COMPLETAR CUIT]",
  ciudad: "[COMPLETAR CIUDAD]",
  emailSoporte: "soporte@botclo.com",
  emailPrivacidad: "privacidad@botclo.com",
} as const;
