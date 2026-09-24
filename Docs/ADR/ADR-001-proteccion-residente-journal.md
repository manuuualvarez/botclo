# ADR-001 — Protección residente y journal de ejecución

Fecha: 2026-09-24. Decisión aprobada por Manu al aprobar SDD-001.
Reglas de código: [AGENTS.md](../../AGENTS.md).

## Contexto

El stop legado dependía del proceso local. Un timeout podía provocar reenvío de una compra ya ejecutada; los fills y la posición no se confirmaban juntos. El objetivo es poder recuperar Botclo antes de reconstruir el VPS.

## Decisión

- STOP_LOSS MARKET residente conserva el nivel calculado por `risk.ts`. El trailing se actualiza mediante cancelReplace; durante una caída queda el último nivel confirmado.
- Intención durable antes de HTTP, IDs de bot UUID persistidos y client IDs nuevos por intención. Timeout/5xx no autorizan repetir una orden. Incluso `planned` de un backup se consulta antes de decidir: el proceso original pudo enviar después del backup.
- Fills y proyección contable se aplican juntos en PostgreSQL. Importes decimales e IDs de Binance permanecen exactos; floats solo en la proyección existente de UI/indicadores.
- Tras vincular una orden se consulta por su orderId estable: Binance puede renombrar clientOrderId al cancelar. La vinculación inicial exige client ID; los replays conservan cuenta/entorno/símbolo/side/type.
- cancelReplace con STOP_ON_FAILURE y ONLY_NEW: no puede consumir un snapshot de cantidad anterior a un fill parcial. Un resultado parcial se concilia por separado.
- Scheduler, ejecución manual y lifecycle comparten advisory lock sobre sesión reservada. Pausar detiene señales; conciliación y protección de bots adoptados continúan.
- Adopción verifica el historial legado. Un saldo no prueba atribución. Identidades o journals ausentes tras restore requieren revisión, no se reconstruyen presupuestos desde la billetera.
- Rollout con flag explícito. Una vez adoptado, desactivar el flag nunca reactiva el ejecutor legado para ese bot. CI es requisito del deploy manual.

## Alternativas consideradas

- Stop local: mantiene exactamente el mecanismo anterior con menos código, pero no protege durante el corte del VPS.
- STOP_LOSS_LIMIT: permite limitar el precio, pero puede quedar sin ejecutar al atravesarlo; cambia el comportamiento solicitado.
- Trailing nativo por porcentaje: seguiría avanzando sin VPS, pero no equivale al chandelier ATR de las estrategias actuales.
- Reenviar el mismo client ID: simple, pero Binance permite reutilizar IDs tras ciertos estados terminales; no garantiza ejecución única.
- Cancelar todas las órdenes: simplifica liberar saldo, pero afectaría órdenes manuales y de otros bots; descartado.

## Consecuencias y verificación

Hay una ventana real BUY→STOP y cancelación→reemplazo. Los estados pendientes/rechazados se muestran, no se etiquetan como cobertura confirmada. No se agrega liquidación automática ante falla de protección. DCA y stopAtr=0 conservan su política.

Pruebas offline inyectan aceptación con respuesta perdida, carreras, snapshots viejos, fills parciales, comisiones y replays; integración contra PostgreSQL aislado verifica transacciones y migraciones. Manu decidió omitir Testnet el 24/09/2026: el contrato online no se declara validado.

Fuentes verificadas: [órdenes y cancelReplace](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/trade), [consultas de cuenta y fills](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/account), [filtros](https://developers.binance.com/en/docs/products/spot/filters).
