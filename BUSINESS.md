# Botclo — Modelo de negocios

> Informe elaborado con un agente experto en negocios SaaS (julio 2026).
> Benchmarks verificados contra 3Commas, Cryptohopper, TradeSanta y Pionex.
> Supuesto cambiario: ARS 1.500/USD. **Decisión final: pendiente de Manuel.**

## Recomendación: suscripción mensual (opción b), con anual prepago como único elemento mixto

**Descartar la venta de estrategias (opción a).** Ningún jugador relevante del
mercado vende estrategias como compra única — todos los SaaS de bots son
suscripción. Razones:

1. **El costo es recurrente, el ingreso debe serlo**: un robot 24/7 consume
   infra y mantenimiento para siempre. LTV comparado: compra única ≈ US$15-20
   una vez; suscripción US$15/mes con churn 7% ≈ **US$180-210 (10×)**.
2. **La inflación mata al pago único en ARS.** MercadoPago permite actualizar
   el monto de un preapproval (`PUT /preapproval/{id}`) → precios ajustables
   trimestralmente sin re-autorización.
3. **Incentivos alineados** + un solo eje de decisión de compra para usuarios
   no técnicos (las 8 estrategias van dentro de los planes).
4. **Anual = pago único de Checkout Pro** (10 meses al precio de 12): encaja
   con MercadoPago y es la principal herramienta anti-churn en bear markets.

## Planes propuestos

| | Práctica (gratis) | **Botclo Real** ARS 15.000/mes (~US$10) | **Botclo Pro** ARS 32.000/mes (~US$21) |
|---|---|---|---|
| Modo | Solo testnet | Dinero real | Dinero real |
| Robots | 2 (testnet) | 2 reales | 5 reales |
| Estrategias | 8 + backtest | 4 base | Las 8 |
| Backtests | 15/mes | Ilimitados | Ilimitados |
| Telegram | Sí | Sí | Sí + resumen semanal |

- Anual: 10×12 (ARS 150.000 / 320.000, pago único).
- Precio de entrada 30-35% debajo del piso internacional (TradeSanta US$15/mes).
  Pitch: "lo que afuera cuesta 25 dólares, acá cuesta 10, en pesos".
- El precio comunica que Botclo es para carteras de US$800+ — decirlo en el
  onboarding para evitar churn de carteras chicas.
- Margen bruto >90% (MP retiene ~4-8% + IVA según plazo de liberación).

## Qué NO cobrar nunca

1. El modo práctica completo (testnet) — es el funnel entero.
2. El backtesting básico (limitado por cantidad en gratis, nunca paywalleado).
3. La cartera en vivo (gancho de uso diario).
4. El quiz de perfil y contenido educativo.
5. **Los stops y avisos de riesgo de posiciones abiertas — JAMÁS se cortan
   por falta de pago.**

## Cortesías / grants

- Tabla `grants`: user_id, plan, otorgado_por, motivo, desde, vence
  (nullable), revocado. Plan efectivo = max(plan pago, grant vigente).
- Códigos de invitación nominales o de canje limitado (trazables).
- **Plan Fundador**: primeros 20-30 usuarios activos → 50% de por vida
  (NO gratis vitalicio: quien paga algo da señal real).
- Amigos: grant gratis con vencimiento a 6 meses, renovable a mano.
- Cap: grants activos ≤ 15% de la base paga. Grants excluidos del MRR.

## Ciclo de cobranza (MercadoPago)

Máquina de estados propia alimentada por webhooks de preapproval:

| Día | Estado | Acción |
|---|---|---|
| 0 | pago_fallido | Servicio intacto. Aviso in-app + Telegram + email |
| 3 | en_gracia | Recordatorio + link de pago único "de rescate" (Checkout Pro) |
| 6 | en_gracia | Último aviso antes de la pausa |
| 7 | **pausa_suave** | No abre posiciones nuevas. **Stops y avisos siguen activos** |
| 30 | cancelada | Robots archivados (config e historial se guardan), baja a gratis |

**Regla de oro: jamás cerrar posiciones por falta de pago** (pausa suave).
Cerrar posiciones ajenas por motivo administrativo es tóxico y con probable
exposición legal. Documentarlo en los Términos. Reactivación: mismo día, sin
castigo.

## Métricas del panel admin

1. **MRR** (en ARS y USD financiero; anuales /12; grants excluidos)
2. **Churn mensual** (separar voluntario vs. involuntario/fallo de cobro; sano <5-7%)
3. **Conversión práctica→pago** (robot testnet → plan pago en 60 días; meta 10-15%)
4. **Activación** (7 días: conecta Binance + 1 backtest + 1 robot testnet)
5. **Tasa de cobro exitoso** (alarma si <85-90% — problema de cobranza, no producto)
6. **% de pagos con ≥1 robot real activo** (indicador adelantado de churn)
7. **LTV** = ARPU × 0,9 / churn (con ARS 18.000 y 7% ≈ ARS 230.000 ~US$155; LTV/CAC ≥ 3)

## Riesgos

- **#1: churn correlacionado con el mercado** (bear → cancelaciones en masa).
  Mitigar: anual con descuento (vendido en bull), estrategias DCA/hold que
  retienen en bear, pausa voluntaria de suscripción (1-2 meses/año), precios
  bajos, y expectativas honestas (los backtests con drawdown real como escudo).
- Estacionalidad: presupuestar con el peor trimestre.
- Dependencia de Binance (API/regulación) y de una cuenta de MP.
- **Nunca cobrar % de ganancias** (complica cobranza y acerca a la figura de
  administración de inversiones).

## Nota legal (consultar contador + abogado ANTES de cobrar)

- **Prioritario — CNV/Ley 27.739/PSAV**: confirmar por escrito que ejecutar
  órdenes automatizadas configuradas por el propio usuario, sin custodia, no
  encuadra como gestión de carteras ni exige registro PSAV.
- Defensa del consumidor: botón de arrepentimiento (10 días), baja tan fácil
  como el alta, precios finales con impuestos.
- Publicidad: jamás prometer rendimientos.
- Facturación: monotributo servicios + factura C automatizable por webhook;
  ojo topes de categoría e IIBB (MP retiene).
- Datos personales (Ley 25.326): política de privacidad + registro AAIP.

## Resumen ejecutivo

Suscripción mensual (preapproval MP) + anual con descuento (pago único);
freemium con testnet completo y backtesting gratis; dos tiers: ARS 15.000
(2 robots) y ARS 32.000 (5 robots); Plan Fundador 50% de por vida para los
primeros 20-30; gracia de 7 días → pausa suave que nunca cierra posiciones;
consulta legal PSAV/CNV antes de cobrar.
