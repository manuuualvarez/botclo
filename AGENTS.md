<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Botclo — Guía del proyecto

SaaS de asesoría cripto sobre Binance (cartera, análisis, estrategias,
backtesting, bot de trading). Usuario final: gente NO técnica de Argentina —
toda la UI en español rioplatense (voseo), con flujos paso a paso.

## Comandos

- `pnpm dev` — levanta TODO en Docker (web con hot-reload + Postgres) en :3000
- `pnpm dev:down` — baja los contenedores de desarrollo
- `pnpm dev:local` — `next dev` sin Docker (sin DB)
- `pnpm build` / `pnpm lint` — build y lint locales (rápidos, usalos para verificar)
- Tras cambiar `.env`: `docker compose -f docker-compose.dev.yml up -d --force-recreate web`
  — ¡OJO: `restart` NO relee el env_file, conserva el del momento de creación!
- `pnpm prod` — build+up de producción (docker-compose.yml, target `runner`)

## Convenciones

- Next.js 16 App Router, `src/` dir, alias `@/*`, TypeScript estricto.
- UI: Tailwind v4 + shadcn/ui (componentes en `src/components/ui`, NO editar a
  mano — regenerar con `pnpm dlx shadcn@latest add <comp>`). Acento de marca:
  esmeralda (`emerald-400/500`) sobre tema oscuro (clase `dark` fija en layout).
- 3D: react-three-fiber; los canvas SIEMPRE con `dynamic(..., { ssr: false })`
  y DPR acotado.
- Identidad de marca centralizada en `src/config/site.ts`.
- Config por entorno SOLO vía `.env` (leído por docker-compose). Actualizar
  `.env.example` al agregar variables. Las `NEXT_PUBLIC_*` se hornean en build
  (ver args en Dockerfile/compose).

## Reglas del dominio (importante)

- **Nunca** apuntar a la API real de Binance en desarrollo: usar el Spot
  Testnet (`BINANCE_USE_TESTNET=true`). El usuario tiene ~500 USD reales que
  solo se usan post-deploy, con su aprobación explícita.
- Las API keys de Binance de usuarios se guardan cifradas (AES-256-GCM con
  `ENCRYPTION_KEY`), jamás en texto plano ni en logs.
- Toda feature de trading debe tener modo práctica antes que modo real.

## Arquitectura (dónde vive cada cosa)

- `src/db/schema.ts` — Drizzle: credenciales cifradas, perfiles, bot, trades.
  Tras cambiarlo: `pnpm db:push:docker`.
- `src/lib/binance/` — cliente HTTP firmado (HMAC), credenciales, cartera.
  Datos de mercado SIEMPRE de data-api.binance.vision; cuenta/órdenes del
  testnet (o real según `BINANCE_USE_TESTNET`).
- `src/lib/strategies/` — 8 estrategias como funciones puras `signalAt(velas, i)`
  SIN mirar el futuro (hay test anti look-ahead). Registrar nuevas en index.ts.
  Los params `stopAtr`/`trailingAtr` activan el overlay de riesgo. Las señales
  se evalúan SIEMPRE vía `evalSignal` (ventana canónica warmup+60): así el
  backtest y el ejecutor deciden con los mismos datos exactos (los indicadores
  recursivos dependen del largo de la serie — hay test de paridad en CI). Las
  señales de venta deben ser por NIVEL, no solo en la vela del cruce (si el
  robot se pierde una vela, la señal tiene que repetirse).
- `src/lib/risk.ts` — overlay de riesgo COMPARTIDO (stop inicial, clamps
  3–20%, fallback 8%, trailing chandelier, ATR sobre ventana fija): única
  implementación para backtest y ejecutor.
- `src/lib/backtest.ts` — simulador honesto: comisión 0,1% + slippage por par,
  stops evaluados contra el LOW intra-vela y gaps de apertura (regla
  pesimista), trailing chandelier calculado con datos hasta t−1, drawdown
  contra el low intra-vela, SIN interés compuesto (el robot opera presupuesto
  fijo), DCA con la política real del ejecutor (chunk fijo hasta agotar),
  métricas con profit factor/costos/aviso de muestra chica. Backtest y
  ejecutor comparten decisión (evalSignal), riesgo (risk.ts) y sizing — si
  divergen, es un bug. Los períodos del laboratorio se traducen a velas del
  intervalo REAL de la estrategia (getKlinesPaged pagina de a 1000).
- `src/lib/bot/executor.ts` — multi-robot (hasta 5 por usuario, uno por par
  con presupuesto propio): cada tick chequea stops contra el precio actual,
  y al cierre de vela nueva evalúa la señal (idempotente vía
  last_candle_time) y ejecuta a lo sumo una orden MARKET. El lock del tick es
  de sesión sobre una conexión RESERVADA (`pg.reserve()`): lock y unlock en
  la misma conexión garantizado, sin transacción abierta durante el barrido
  (a través del pool el lock podía quedar tomado para siempre). Una VENTA
  fallida devuelve la vela reclamada y se reintenta el próximo tick (jamás
  se descarta); si Binance no encuentra el saldo (-2010, posición
  desincronizada) o la posición es polvo invendible, se da por cerrada con
  alerta — el robot nunca queda congelado. Una compra fallida espera a la
  señal siguiente. Las pérdidas achican el presupuesto (investedAfterSell):
  el robot jamás repone plata del wallet — misma regla que el backtest. El
  intervalo del robot es el de la estrategia (único backtesteado) — no se
  elige, y el ejecutor lo deriva de la estrategia aunque la fila diga otra
  cosa. Decisiones puras testeables en `src/lib/bot/decisions.ts`; intervalos
  (ms/velas/etiquetas) SOLO desde `src/lib/intervals.ts`. Notifica cada
  operación por Telegram si el usuario lo configuró (token cifrado en DB).
  `POST /api/bot/tick` (público en proxy, autentica CRON_SECRET); el servicio
  `bot` del compose lo dispara cada BOT_TICK_SECONDS.
- `src/lib/bot/insight.ts` — "qué está mirando el robot" en lenguaje claro.
- Snapshots de cartera (1/hora) alimentan el gráfico de evolución del dashboard.
- Server actions junto a cada página (`actions.ts`); validación con zod y
  clamp de parámetros SIEMPRE en el servidor.

## Estado / fases

1. ✅ Base: scaffold, Docker dev+prod, landing 3D
2. ✅ Clerk: app `app_3GHoc2KvkhvqLI70CtenusC9DM8`, CLI autenticada, esES,
   theme shadcn, rutas /sign-in /sign-up, /dashboard protegido vía src/proxy.ts
   (instancia de producción de Clerk aún no configurada — pendiente para el deploy)
3. ✅ Binance testnet: conexión guiada, keys cifradas, cartera en vivo
4. ✅ Estrategias: perfil (quiz), DCA / sma-cross / rsi-reversion, backtest con
   gráfico (recharts)
5. ✅ Bot: executor + scheduler en compose + UI (configurar/pausar/ejecutar ahora)
6. ⏳ Deploy a VPS Hostinger — guía paso a paso en README.md (secciones 3-6);
   requiere decisión del usuario (dinero real solo con
   BINANCE_USE_TESTNET=false + ALLOW_REAL_TRADING=true)
7. ✅ Monetización (modelo en BUSINESS.md, capacidad en INFRA.md):
   - Límites de planes en src/config/plans.ts (producto, requiere deploy).
     PRECIOS en DB, editables desde /admin/planes (src/lib/plan-prices.ts,
     caché 60s, fallback a config). Plan efectivo: src/lib/plan.ts
     (resolvePlan puro + getEntitlement) = max(sub, grant).
   - Enforcement: robots (cantidad/estrategias/modo real) en robot/actions y
     páginas; cuota de backtests gratis en estrategias/[id]/actions; ejecutor
     con "pausa suave" (sin plan o moroso: NO compra, SÍ stops y ventas).
   - MercadoPago: src/lib/mp.ts (preapproval mensual + preferencia anual,
     firma de webhooks; NO se crean "productos" en MP, todo por API),
     src/lib/billing.ts (pagos idempotentes por mp_payment_id + máquina de
     cobranza), webhook público en /api/mp/webhook, dunning horario en tick.
   - App MP: "NorteInversiones" en la cuenta real de Manuel. En dev va el
     token TEST- ; en prod el APP_USR- de producción. OJO: la API de
     suscripciones exige que payer_email sea el email REAL de una cuenta de
     prueba compradora (MP_TEST_PAYER_EMAIL) — con emails inventados da 500.
   - Admin: grants desde /admin/usuarios (con vencimientos visibles), precios
     desde /admin/planes, MRR real en /admin. El rol admin NO da bypass de
     plan (a pedido de Manuel, para poder probar el enforcement): para operar
     sin límites, darse una cortesía sin vencimiento.
