# Botclo — Capacidad y costos de infraestructura

> Informe de un agente experto en capacity planning (julio 2026). Precios de
> renovación REALES del catálogo Hostinger de la cuenta de Manuel (vía API),
> a ARS 1.500/USD. Los weights de Binance verificados: account=20, klines=5,
> ticker=2, orden=1; límite 6.000 weight/min POR IP (ban 418 si se ignora).

## Capacidad por escalón (supuestos: 40% conectan Binance, 25% con ~2 robots, 10% DAU)

| Usuarios | Plan VPS | Costo total/mes | Cuello de botella |
|---|---|---|---|
| 10-100 | KVM 1 (o KVM 2) | ~US$ 22 | Ninguno |
| 500 | KVM 2 | ~US$ 29 | **Tick secuencial de bots ROTO** (250 bots × 350ms > 60s) → paralelizar |
| 1.000 | KVM 2 | ~US$ 29 | Event loop (backtests CPU) → worker_threads |
| 5.000 | KVM 4 | ~US$ 59-80 | **La IP única contra Binance** (~70% del weight) → WebSockets |

- **Costo marginal por usuario: US$ 0,01-0,02/mes** por encima de 100 usuarios.
- **Break-even de infra: 3-6 suscriptores** de un plan de US$ 5-10.
- Techo duro de una sola IP contra Binance: ~5.500 registrados (con
  WebSockets se corre a >10.000).
- Postgres nunca es el cuello en estos escalones; disco sobra siempre.

## Decisión recomendada de arranque

**KVM 2 directo** (~US$ 23/mes renovación; +US$ 5,5 vs KVM 1 y llega a ~1.000
usuarios sin migración). Clerk queda gratis hasta 10.000 MAU.

## Backlog técnico de escala (en orden, con umbral que lo dispara)

1. **Jitter de snapshots + gobernador de weight** (cola de salida a Binance
   leyendo el header `X-MBX-USED-WEIGHT-1M`, backoff en 429) — 0,5-1 día.
   Obligatorio antes de ~750 registrados. Evita el ban de IP (peor incidente
   posible: tumba a TODOS los usuarios).
2. **Paralelizar el tick** (concurrencia 15-25 + timeout de 2s por bot) —
   0,5-1 día. Antes de ~170 bots activos (N≈350).
3. **Backtests a worker_threads** (cola, máx 2 simultáneos) — 1-2 días.
   Cuando el event loop lag p99 pase 200ms (N≈1.000+).
4. **WebSocket streams de Binance** (precios/klines a weight 0) — 2-4 días.
   Para 5.000+; evita la segunda IP.

## Mitigación de riesgo prioritaria (producto, no infra)

**Stops como órdenes STOP_LOSS_LIMIT/OCO reales en Binance** en vez de stops
gestionados por la app: si el VPS se cae, las posiciones quedan protegidas
por el exchange. Es la optimización #1 en importancia antes del dinero real.

## Señales de alarma a monitorear

| Métrica | Warning | Crítico |
|---|---|---|
| `X-MBX-USED-WEIGHT-1M` | >3.600 sostenido | >4.800 → degradar (caché 30s, pausar snapshots) |
| HTTP 429/418 de Binance | 1 en 24h | Cualquier 418 → circuit breaker total |
| Duración del tick | >30s → paralelizar | >45s o solapado → particionar |
| Event loop lag p99 | >100ms | >200ms → worker_threads |
| RAM VPS | >75% sostenido | swap activo → subir plan |
| Tabla snapshots | >1 GB → retención | >2 GB → retención YA |

## Datos y backups

- **Retención de snapshots**: horario 90 días → 1/día hasta 2 años → 1/semana
  (DELETE nocturno en el scheduler, 2-4 h de trabajo). Reduce el crecimiento 8×.
- **Backups**: `pg_dump | gzip` nocturno → Backblaze B2/Cloudflare R2
  (7 diarios + 4 semanales + 12 mensuales, ~US$ 0,10/mes) + snapshot manual
  pre-deploy. Desde 1.000 usuarios: WAL archiving (RPO ~5 min).
  **Probar el restore una vez por trimestre.**
- **Separar la DB** (Postgres gestionado, US$ 15-25/mes: DigitalOcean/Neon/
  Supabase — Hostinger no ofrece): recién al superar ~1.000 usuarios pagos.
