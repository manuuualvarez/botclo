# Botclo — Documentos legales y compliance

> **AVISO:** Material elaborado con asistencia de IA (agente legal especializado
> en fintech/derecho del consumidor argentino, Fable 5). **No reemplaza la
> revisión de un abogado matriculado.** Antes de operar con dinero real de
> terceros, someter a revisión profesional — en especial el encuadre PSAV y la
> cláusula de limitación de responsabilidad. Completar los campos `[...]` con
> datos reales (DNI, CUIT, domicilio) antes de publicar.

Los documentos publicables (T&C, Privacidad, Riesgo, Aviso Regulatorio) están
implementados como páginas en `/legal/*` y su fuente vive en
`src/config/legal-content.tsx`. Este archivo conserva el análisis regulatorio
interno y las recomendaciones de compliance que NO se publican.

---

## Análisis regulatorio interno (NO publicar) — encuadre PSAV

**Marco:** Ley 27.739 (2024) modificó la Ley 25.246 e incorporó el art. 4 bis
(PSAV). RG CNV 994/2024 creó el registro; RG CNV 1058/2025 lo reglamentó
(requisitos patrimoniales, cumplimiento, ciberseguridad, plazos de adecuación
2025). Los PSAV son sujetos obligados ante la UIF. Exención: operaciones que no
superen 35.000 UVA/mes.

**¿Botclo es PSAV? Por categoría del art. 4 bis:**
- (i)(ii) Intercambio: **NO** — quien casa órdenes y liquida es Binance; Botclo
  cobra suscripción de software, no spread ni comisión por operación.
- (iii) Transferencia: **NO** — las keys no tienen permiso de retiro.
- (v) Oferta/venta de activos: **NO** — no emite ni coloca tokens.
- (iv) Custodia/administración: **ZONA GRIS.** Botclo no custodia (no tiene las
  claves privadas ni posesión). "Administración… o instrumentos que permitan el
  control" admite dos lecturas:
  - *Pro-Botclo (defendible):* la categoría sigue el estándar GAFI (poder de
    disposición: mover/retirar/entregar). Una API key sin retiro no da "control"
    en ese sentido; solo cambia composición dentro de la cuenta del propio
    usuario, revocable en cualquier momento. Botclo = terminal de trading, no
    administrador. El usuario decide estrategia/presupuesto/activación: sin
    discrecionalidad (no es managed account).
  - *De riesgo:* el robot decide *cuándo* operar de forma autónoma dentro de la
    estrategia; podría argumentarse que ejercer trading sobre cuentas de terceros
    de forma habitual y onerosa es "administrar". La CNV no publicó criterio
    específico sobre bots no custodiales → no hay puerto seguro.

**Conclusión:** posición defendible = NO es PSAV, pero es interpretación.
**Mitigantes a mantener a rajatabla:** (1) jamás aceptar keys con retiro
(validarlo técnicamente); (2) el usuario configura y activa todo, con evidencia
registrada; (3) suscripción plana, nunca comisión por operación ni success fee;
(4) no dar recomendaciones personalizadas (el quiz = educativo, "riesgo máximo
tolerado", no "te recomendamos X para vos"); (5) disclaimers consistentes.

**Riesgo de persona física:** responsabilidad ilimitada — un reclamo (usuario
que pierde y demanda, sanción, incidente con keys) va al patrimonio personal.
Sanciones CNV si considerara actividad registrable no registrada (cese, multas
Ley 26.831, bloqueo, UIF). Público minorista no técnico = el más protegido por
las autoridades.

---

## Recomendaciones de compliance (para Manuel)

**Fiscal:** monotributo en ARCA (actividad servicios de software), Factura C
electrónica por cada cobro (MercadoPago informa a ARCA). Ojo topes del
monotributo: unos cientos de suscriptores te excluyen → planificar pase a
régimen general (IVA 21% + Ganancias) ANTES. IIBB provincial / Convenio
Multilateral al crecer.

**Datos:** inscribir la base en el Registro Nacional de Bases de Datos de la
AAIP (gratis, por TAD — obligación legal arts. 3 y 21 Ley 25.326). Mantener
cifrado AES-256-GCM de keys, backups cifrados, y **validación activa de que las
keys no tengan permiso de retiro**.

**Sociedad — recomendación firme:** constituir **SAS unipersonal antes del
dinero real**. Operás software que ejecuta órdenes sobre fondos de terceros; un
incidente puede superar cualquier facturación. La SAS separa el patrimonio
personal, se constituye online, capital mínimo bajo. Registrar la marca en INPI;
explorar seguro de RC profesional/ciber.

**Consumidor:** botón de arrepentimiento (Res. 424/2020 SCI: link destacado en
la home, sin registro), cancelación en un clic (art. 10 ter Ley 24.240), guardar
evidencia de todas las aceptaciones legales, cero promesas de rentabilidad en
marketing (la publicidad integra el contrato — art. 8 Ley 24.240), modo práctica
por defecto como mitigante.

**Lavado:** mientras no sea PSAV, sin deberes UIF. Igual: no aceptar cuentas de
terceros distintos del usuario, suspender y documentar uso ilícito.

**Checklist previo al dinero real:** (1) revisión de abogado matriculado
(encuadre PSAV + cláusula de responsabilidad); (2) constituir SAS; (3)
monotributo + facturación; (4) inscribir base en AAIP; (5) implementar la spec
de pantallas con la tabla `legal_acceptances`; (6) botón de arrepentimiento en
la home; (7) validación de keys sin retiro; (8) cero promesas de rentabilidad.

---

## Especificación de pantallas (implementada)

Ver `src/config/legal.ts` (versiones), tabla `legal_acceptances` (registro de
consentimientos) y los componentes en `src/components/legal/`. Resumen de dónde
va cada requisito:

| Pantalla | Requisito | Aceptación |
|---|---|---|
| Sign-up | Aviso no-asesoramiento/no-custodia + link a docs | checkbox (registro tos+privacy+risk) |
| Conexión Binance | Aviso "key sin retiro" + mandato de operar | checkbox `binance_connect` + rechazo técnico de keys con retiro |
| Backtesting | "Simulación, no predice; podés perder todo" | aviso permanente (sin checkbox) |
| Robot modo práctica | "Fondos de prueba, sin riesgo" | aviso |
| Robot 1ª vez real | Modal: scroll + checkbox + tipear ACEPTO | registro `robot_real` con snapshot |
| Robot reactivación real | Resumen de estrategia/par/presupuesto | confirmación |
| Checkout MercadoPago | Precio, renovación automática, arrepentimiento 10 días | checkbox |
| Footer global | Links legales + botón arrepentimiento + leyenda AAIP/no-asesoramiento | — |
