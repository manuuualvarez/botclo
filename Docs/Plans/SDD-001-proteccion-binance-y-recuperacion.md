# SDD-001 — Protección en Binance y recuperación de Botclo

Estado: **aprobado por Manu; implementación en curso**. Fecha: 24/09/2026.

Cambio de alcance autorizado el 24/09: Manu decidió omitir Testnet por no disponer de cuenta. Se mantienen tests offline, persistencia y restauración; no se afirma contrato online validado. F4.S1 se verifica localmente, y su criterio específico de Testnet queda omitido por decisión explícita. La activación real y el corte del VPS son etapas operativas posteriores.

Objetivo autorizado: incorporar protección residente en Binance y conciliación de operaciones para poder reconstruir después el VPS sobre una instalación limpia con Coolify, sin n8n. Este documento concreta el plan antes de escribir tests o código de producción, conforme a las instrucciones de Manu. Las reglas del proyecto se referencian en [AGENTS.md](../../AGENTS.md).

## Resultado esperado y límites

Una posición con stop habilitado y **orden protectora confirmada en Binance** conserva esa orden si se apaga Botclo. Al volver, el bot recupera los fills y concilia su posición, presupuesto y protección antes de permitir nuevas operaciones.

Esto no garantiza el precio de ejecución, liquidez o disponibilidad del exchange. Tampoco elimina la ventana entre ejecutar una compra y confirmar su protección, ni hace atómico un reemplazo de orden. Esos estados deben ser visibles y recuperables; no se presentan como posiciones protegidas.

La reinstalación del VPS sigue requiriendo backups externos de DB, secretos y configuración, y una restauración real de ensayo. La orden protectora no sustituye los datos de usuarios, pagos, robots y estrategias. No se reconstruye una instalación vacía adjudicando saldos de Binance a robots.

## Evidencia verificada

- El ejecutor consulta stops localmente y envía MARKET: [executor.ts:407](../../src/lib/bot/executor.ts#L407).
- Los reintentos actuales no distinguen una orden rechazada de un resultado desconocido. La compra, el historial y la actualización de posición se escriben por separado.
- El scheduler tiene lock, pero “Ejecutar ahora” llama al ejecutor sin adquirirlo: [actions.ts:179](../../src/app/dashboard/robot/actions.ts#L179).
- Eliminar un robot o desconectar credenciales puede descartar información necesaria para administrar exposición. La pausa actual deja de ejecutar ventas.
- El manejo de `-2010` borra posiciones suponiendo falta de saldo. Con órdenes protectoras, un saldo bloqueado no demuestra que la posición haya desaparecido.
- Las migraciones versionadas omiten al menos `watched_candle_time` y `candle_reports`, presentes en el schema. No se reescribirá la migración inicial ya aplicada.
- El deploy actual corre ante push a `main` sin depender del resultado de CI. Los cambios se prepararán fuera de `main`; publicar documentación o una rama no debe activar un deploy.
- Consulta READ ONLY de producción del 24/09: se confirmó exposición administrada por stops locales. El detalle operativo se conserva en evidencia privada fuera del repositorio. No se emitieron órdenes.
- Consulta pública `exchangeInfo` del 24/09: BTCUSDT, ETHUSDT y SOLUSDT admiten `STOP_LOSS` y `cancelReplace`. La implementación comprobará capacidades y filtros del símbolo y entorno real de cada operación; este muestreo no prueba el contrato de Testnet.

## Decisiones propuestas

### 1. Protección residente conservando la estrategia

Usar `STOP_LOSS` de venta a mercado donde el símbolo y la cuenta lo admitan. No reemplazarlo silenciosamente por `STOP_LOSS_LIMIT`: el segundo puede dispararse y quedar sin fill. Si no se admite el mecanismo elegido, no abrir nuevas posiciones bajo el modo protegido y mostrar la limitación.

Conservar el cálculo ATR/chandelier de `risk.ts`. El precio confirmado del stop queda en Binance; Botclo calcula y solicita sus actualizaciones. Si el VPS cae, se mantiene **el último nivel aceptado**, pero el trailing ATR no sigue avanzando. El trailing porcentual nativo no es equivalente y queda fuera del alcance.

Separar stop deseado, stop confirmado y cantidad efectivamente cubierta. Un timeout o rechazo no puede actualizar el nivel mostrado como confirmado.

DCA conserva su comportamiento de acumulación sin ventas ni stop. Tampoco se agrega un stop a configuraciones que lo deshabilitan. La UI lo explicita; no se promete protección universal.

### 2. Intención durable antes de cada orden

Registrar la intención y un identificador estable antes del request a Binance. Mantener identidad de cuenta, entorno, bot y operación, sin reutilizar identificadores tras restaurar un backup viejo.

Registrar órdenes y fills con constraints de unicidad y aplicar cada fill, movimiento de posición y efecto sobre el presupuesto en una única transacción local. Conservar comisiones y cantidades exactas; cálculos de filtros y parámetros de orden con representación decimal exacta usando herramientas nativas, sin refactor general de indicadores/backtest.

Ante timeout, desconexión o 5xx: consultar la orden antes de reintentar. Un `newClientOrderId` estable ayuda a localizarla, pero no basta para garantizar idempotencia: Binance permite reutilizarlo en determinadas condiciones posteriores al fill. Un resultado todavía desconocido bloquea órdenes incompatibles; no se transforma en una compra nueva.

### 3. Conciliación como paso previo

Antes de decisiones nuevas, consultar órdenes/fills propios y conciliar robots con exposición, órdenes pendientes o resultados inciertos, incluso estando pausados. Se usa polling REST con el scheduler existente; un servicio WebSocket nuevo no es requisito de esta entrega.

Los saldos `free + locked` sirven como control, no para probar propiedad. Puede haber varios robots del mismo par, órdenes manuales, depósitos o movimientos a Earn. Solo se atribuyen fills demostrablemente vinculados al robot. Discrepancias o historial incompleto dejan un estado de revisión y bloquean nuevas compras.

Un stop ejecutado durante una caída debe actualizar una sola vez cantidad, producido neto, presupuesto, cooldown e historial. El cooldown se deriva del evento remoto y la política existente, no se reinicia indefinidamente con cada replay.

La restauración debe incluir un manifiesto externo de identidades de cuenta/entorno/bot y release, además de backups. Una cuenta con actividad Botclo no atribuible se bloquea para revisión; no se infieren estrategias o presupuestos desde el balance.

### 4. Ventas y cambios del stop coordinados

Scheduler, ejecución manual y acciones que cambian robots/credenciales comparten exclusión mutua y recargan el estado después de adquirir el lock. No se mantiene una transacción PostgreSQL abierta durante las llamadas de red.

Para reemplazo de stop o venta por señal se usa el contrato validado de `cancelReplace` con `STOP_ON_FAILURE` cuando corresponda. Se inspeccionan por separado cancelación y nueva orden: puede cancelarse la primera y fallar la segunda. Si existe fill parcial, resultado incierto o carrera con el stop, se concilia antes de decidir qué cantidad queda disponible. No usar `ALLOW_FAILURE` ni cancelar todas las órdenes de la cuenta.

Si una compra se ejecuta y la protección falla, la posición queda explícitamente sin protección confirmada: bloquear nuevas compras, recuperar/consultar la intención protectora y alertar. No liquidar automáticamente como nueva política implícita. Si no se puede confirmar la cobertura, esa posición impide el corte del VPS.

### 5. Semántica de controles

- **Pausar:** suspende nuevas decisiones por estrategia y avance del trailing, conserva el último stop residente y sigue conciliando. Esto cambia el comportamiento y los textos actuales.
- **Ejecutar ahora estando pausado:** solo revisar/conciliar; no comprar ni vender por señal.
- **Reanudar:** conciliar primero; no operar con un estado anterior a la pausa.
- **Eliminar:** bloquear mientras exista exposición, protección viva o resultado incierto; conservar historial e identidades necesarios para recuperación.
- **Desconectar/cambiar cuenta:** bloquear el flujo ordinario con exposición u órdenes pendientes. La rotación de claves sobre la misma cuenta exige verificar cuenta/entorno y acceso a las órdenes; si no se puede probar, no sobrescribir las claves anteriores.
- **Error de saldo:** `-2010` deja de ser evidencia suficiente para borrar una posición. Se revisan órdenes, fills y saldo bloqueado.

No se agregan flujos de liquidación manual, cambio de estrategia ni gestión discrecional de la cartera.

## Fases y subfases

Cada subfase sigue tests en rojo por el motivo correcto → implementación mínima → tests verdes, lint/build sin warnings → auditoría y `Docs/Progress.md`. Su estado final será “implementada, pendiente de validación” hasta el cierre de Manu.

### F1.S1 — Entorno de prueba y migraciones reproducibles

**Prerrequisitos:** aprobación del plan; rama de trabajo; runtime alineado con Node 24 del CI.

**Tarea:** harness de órdenes con `node:test`, `node:assert/strict` y `tsx` existente; PostgreSQL 17 exclusivo para tests. Completar el historial de migraciones mediante una nueva migración compatible con bases donde las columnas ya existen. Preparar gate de deploy para impedir activación antes de validación.

**Tests primero:** DB vacía → schema utilizable; DB de versión anterior → actualización sin pérdida; reaplicación; migración fallida; pruebas sin red externa. No usar `pnpm dev`, que inicia scheduler, ni el `.env` productivo.

**Aceptación:** [ ] instalación limpia reproducible; [ ] actualización preserva fixtures; [ ] reaplicar no duplica; [ ] CI no puede desplegar un cambio sin checks; [ ] entorno aislado sin trading real.

**Riesgos:** migración incompleta, tocar contenedores locales ajenos, deploy accidental por push/merge. El scheduler local `norte-dev-bot-1` ya estaba corriendo: se usa un proyecto de test separado y no se modifica ese servicio.

### F1.S2 — Journal de intenciones, órdenes y fills

**Prerrequisitos:** F1.S1.

**Tarea:** migración aditiva para identidades durables, intenciones, órdenes, fills y estado de conciliación; constraints e importación transaccional. ADR sobre fuente de verdad, pertenencia y recuperación.

**Tests primero:** fills repetidos/parciales; comisiones en base, quote y BNB; IDs grandes; precisión y dust; restore viejo sin colisión de identidades; dos procesos aplicando un mismo fill.

**Aceptación:** [ ] cada fill se aplica una vez; [ ] posición y presupuesto consistentes; [ ] cuenta/entorno/símbolo delimitan IDs; [ ] migración no crea órdenes ni adopta saldos.

**Riesgos:** duplicar contabilidad o adjudicar tenencias manuales a un robot; redondear hacia una cantidad no poseída.

### F2.S1 — Cliente Binance y resultados desconocidos

**Prerrequisitos:** F1.S2; documentación oficial y contrato del entorno de destino.

**Tarea:** transporte testeable, consulta de órdenes y fills, creación de stop, cancelación/reemplazo, capacidades/filtros y tratamiento explícito de respuestas parciales/desconocidas. Respetar backoff y `Retry-After`.

**Tests primero:** firma y parámetros; fake que acepta la orden pero corta la respuesta; timeout antes del envío; 5xx; query temporalmente sin resultado; 429; cancelación exitosa con reemplazo rechazado; stop ya ejecutado durante una venta.

**Aceptación:** [ ] incertidumbre no genera otra orden económica; [ ] filtros válidos del entorno correcto; [ ] replay encuentra la intención original; [ ] respuestas parciales no se tratan como éxito total; [ ] ningún secreto en errores/logs.

**Riesgos:** confundir ausencia temporal con rechazo definitivo; usar filtros mainnet en Testnet; confiar exclusivamente en `clientOrderId`.

### F2.S2 — Conciliación y exclusión mutua del ejecutor

**Prerrequisitos:** F2.S1.

**Tarea:** reconciliar antes de operar, incluir robots pausados con exposición, unificar lock de tick/acciones, aplicar presupuesto/cooldown a partir de fills. DCA conserva estrategia y suma journaling/recuperación de sus compras.

**Tests primero:** stop ejecutado offline; restart en cada frontera envío/ack/commit; scheduler y botón simultáneos; venta manual; dos bots del mismo par; balance de otro origen; backup previo a compra/venta; histórico paginado/incompleto.

**Aceptación:** [ ] recuperación idempotente; [ ] no operar con exposición ambigua; [ ] misma orden no se contabiliza dos veces; [ ] no vender saldo ajeno; [ ] regresión de estrategia/presupuesto/DCA verde.

**Riesgos:** recomprar después de un stop sin respetar cooldown; inferir propiedad por saldo; pérdida de historial externo; dos instalaciones activas sobre backups distintos.

### F3.S1 — Stop residente y trailing coordinado

**Prerrequisitos:** F2.S2.

**Tarea:** proteger cantidades atribuibles y netas, coordinar venta por señal y reemplazo del stop, persistir nivel deseado/confirmado y mantener estado visible de cobertura. ADR de semántica de protección y fallos.

**Tests primero:** caída después de confirmar stop; compra aceptada con stop rechazado; stop dispara durante reemplazo/venta; partial fill; saldo locked; trailing rechazado; precio ya cruzó el stop al adoptar; instrumento sin soporte.

**Aceptación:** [ ] stop confirmado permanece al matar el proceso de test; [ ] venta total no excede remanente atribuible; [ ] nivel mostrado corresponde a evidencia remota; [ ] estado sin protección bloquea el corte; [ ] ningún stop nuevo implícito para DCA/configuración deshabilitada.

**Riesgos:** intervalo sin cobertura entre compra/protección o cancelación/reemplazo; slippage; polvo; filtros cambiantes. No se afirma cobertura continua en esas ventanas.

### F3.S2 — Controles y estado comprensibles

**Prerrequisitos:** F3.S1.

**Tarea:** aplicar la semántica propuesta de pausa/reanudación/eliminación/desconexión/rotación; mostrar protección confirmada, pendiente, ausente por configuración o conciliación requerida; actualizar mensajes/alertas existentes.

**Tests primero:** pausa mientras tick espera; ejecución manual pausada; delete/desconectar con orden incierta; cambio de cuenta/entorno; rotación válida; fill durante pausa; reintentos sin spam de alertas.

**Aceptación:** [ ] pausa conserva stop; [ ] controles no dejan órdenes huérfanas; [ ] no se sobrescriben credenciales incompatibles; [ ] UI no afirma protección sin evidencia; [ ] verificación en navegador de los flujos modificados.

**Riesgos:** acciones tardías tras pausar; cambio de expectativas del usuario; vender por señal desde “Ejecutar ahora” cuando está pausado.

### F4.S1 — Ensayo de caída/restauración en Testnet

**Prerrequisitos:** F3.S2; credenciales exclusivas Spot Testnet; DB exclusiva; red y destinos restringidos.

**Tarea:** pruebas de contrato separadas del CI ordinario, compra/protección con fondos de prueba, detener el ejecutor, observar orden remota y recuperar por conciliación. Restaurar un backup antiguo en una instalación aislada y verificar replay/estado ambiguo.

**Tests primero:** escenarios de caos como procesos separados con barreras deterministas; el fake debe modelar aceptación antes de perder respuesta, no solamente arrojar errores.

**Aceptación:** [ ] evidencia Testnet de orden residente sin proceso local; [ ] fills offline importados sin duplicación; [ ] restore no genera recompra/venta doble; [ ] tests/lint/types/build ejecutados y verdes; [ ] cero warnings atribuibles al cambio; [ ] auditoría del diff con archivo:línea.

**Riesgos:** Testnet no replica liquidez ni disponibilidad de producción y puede resetearse. Sin credenciales de Testnet no se marca esta fase validada.

### F4.S2 — Adopción controlada de posiciones existentes

**Prerrequisitos:** pruebas offline de F4.S1 verificadas (Testnet omitido por Manu); backup externo restaurable; release fijada; ventana operativa; snapshot fresco de posiciones y órdenes.

**Tarea:** preparar herramienta de preflight sin mutaciones, cruzar historial atribuible con datos de cuenta y producir manifiesto revisable. Desplegar de manera controlada; la activación de órdenes reales queda a cargo de Manu mediante el flujo preparado y verificado. Migrar posiciones una por una, preservando la configuración de stop existente y validando cobertura remota.

**Tests primero:** manifiesto de las posiciones actuales con fixtures anonimizados; saldo insuficiente/locked, posición ya vendida, stop cruzado, orden ajena y adopción repetida. No importar automáticamente por balance.

**Aceptación:** [ ] cada posición tiene cantidad/orden atribuibles; [ ] cada stop requerido está confirmado y verificable en Binance; [ ] no quedan operaciones inciertas; [ ] un solo ejecutor; [ ] sin relevar al motor anterior hasta que el traspaso de cada posición sea inequívoco.

**Riesgos:** cambios entre preflight y activación; una orden puede dispararse inmediatamente; reversión a código antiguo que ignora stops residentes. Rollback de código requiere compatibilidad con esas órdenes: nunca cancelar protecciones para facilitar un downgrade.

### F5.S1 — Reconstruir el VPS sin n8n

**Prerrequisitos:** F4.S2 validada; plan de infraestructura actualizado para reinstalación; backups externos y secretos recuperables de todas las apps; restore de Botclo probado; procedimiento de recuperación aprobado por Manu; confirmación de conservación de IP o coordinación de whitelists.

**Tarea:** preparar Ubuntu limpio + Coolify y proxy independiente. Fijar ventana de mantenimiento y bloquear nuevas entradas del bot, conciliar operaciones en vuelo y obtener dump final/manifiesto; detener el único ejecutor manteniendo las protecciones remotas. Reinstalar únicamente el VPS propio identificado en el inventario privado, restaurar aplicaciones y datos, conciliar fills ocurridos durante el corte y reactivar un solo ejecutor.

**Tests/ensayos previos:** rebuild sin n8n en entorno aislado; restore completo; claves recuperables; rutas/TLS; Clerk; MercadoPago sin transacciones reales; posición cerrada durante mantenimiento; rollback y conciliación antes de reactivar.

**Aceptación:** [ ] sistema/proyectos sin n8n; [ ] Botclo y datos comerciales preservados; [ ] dominio/IP o whitelists correctos; [ ] conciliación posterior al corte resuelta; [ ] un único scheduler; [ ] pruebas funcionales de cada app; [ ] validación final de Manu.

**Riesgos:** borrar volúmenes, perder `ENCRYPTION_KEY`, restaurar estado financiero viejo, imágenes efímeras de Glyco, conflictos proxy y pérdida de escrituras/webhooks durante el corte. Restaurar el backup completo antiguo del VPS devolvería también n8n: sirve como rollback de emergencia, no como resultado final.

## Archivos y alcance previsto

- DB/migraciones: `src/db/schema.ts`, nuevas migraciones y metadata, acceso transaccional en `src/db/`.
- Binance: cliente/contratos/filtros y consultas en `src/lib/binance/`; módulos cortos para intenciones y conciliación en `src/lib/bot/`.
- Ejecución: `executor.ts`, acciones de robot y credenciales; controles y textos afectados, sin rediseñar pantallas completas.
- Verificación: tests actuales conservados, nuevos unitarios de contratos y persistencia, integración PostgreSQL, contrato Testnet separado y fixtures sintéticos.
- Operación: gate de CI/CD, scripts de preflight/recuperación con modo sin mutaciones por defecto, guía de deploy/backup/restauración.
- Documentación: ADRs al aprobar las decisiones; `Docs/Progress.md` por subfase. No refactors ajenos a este lifecycle.

## Fuentes y verificaciones pendientes

[Órdenes Binance](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade): `STOP_LOSS` ejecuta a mercado al activarse; `cancelReplace` puede tener éxito parcial. No es una transacción indivisible.

[Errores/timeouts y límites](https://developers.binance.com/en/docs/products/spot/rest-api): timeout/5xx puede significar ejecución desconocida; corresponde consultar estado, respetar rate limits y backoff.

[Órdenes y fills de cuenta](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account): consultas por símbolo/IDs, paginación e intervalos máximos por request. No se presupone historial ilimitado ni siempre completo.

[Filtros](https://developers.binance.com/en/docs/products/spot/filters), [trailing nativo](https://developers.binance.com/en/docs/products/spot/faqs/trailing-stop-faq), [Testnet](https://developers.binance.com/en/docs/products/spot/testnet/general-info).

El estado ejecutado y la evidencia de pruebas se mantienen en Docs/Progress.md. No existe una estimación de downtime antes del ensayo de restauración de F5.
