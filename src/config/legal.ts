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

// Datos del titular. El CUIT queda pendiente: es el que te da AFIP/ARCA al
// darte de alta en el monotributo (formato 20/23/27-DNI-díg. verificador). No
// lo inventamos porque un CUIT mal formado invalidaría los documentos.
export const LEGAL_HOLDER = {
  nombre: "Manuel Ignacio Álvarez",
  dni: "34.291.269",
  cuit: "[COMPLETAR CUIT — de tu constancia de AFIP/ARCA]",
  domicilio: "Calle 467 N° 4500, City Bell, La Plata, Provincia de Buenos Aires",
  ciudad: "City Bell, Provincia de Buenos Aires",
  // OJO: las casillas @botclo.com todavía no existen — mientras tanto van al
  // email personal de Manuel para que ningún reclamo legal rebote (por acá
  // llegan arrepentimientos y pedidos de derechos ARCO).
  emailSoporte: "alvarezmanuelignacio@gmail.com",
  emailPrivacidad: "alvarezmanuelignacio@gmail.com",
} as const;
