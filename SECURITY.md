# Botclo — Auditoría de seguridad (2026-07-10)

Dos auditorías del código real por agentes especializados (Fable 5). Postura
general: **sólida, por encima del promedio**. El núcleo (cripto, auth,
ownership, gating de trading real, idempotencia de pagos) está bien construido
y no requiere retrabajo. Todos los hallazgos accionables fueron corregidos.

## Hallazgos corregidos

| # | Sev | Hallazgo | Fix |
|---|---|---|---|
| A1 | ALTA | Escalada a admin vía email secundario no verificado | `isAdmin()` exige email primario + verificado (`admin.ts`) |
| A2 | Media-alta | Páginas `/admin` autorizaban solo en el layout | Cada página re-verifica `isAdmin()` |
| **B1** | **CRÍTICO** | **`binanceOrderId` era `integer`**: los orderId del mainnet superan int4 → fallo de registro y recompra en loop en la 1ª orden real | Columna migrada a `bigint` (`schema.ts`) |
| **B2** | **CRÍTICO** | Ticks concurrentes (scheduler solapado) podían ejecutar la misma señal 2× | Lock atómico de vela (`claimCandle`) + `pg_advisory_lock` global del tick |
| B3 | Alta | Puerto 3000 de Docker salteaba ufw (HTTP plano expuesto a internet) | Bind a `127.0.0.1:3000` (`docker-compose.yml`) |
| C1 | Baja | Webhook MP sin anti-replay | Rechazo si `ts` fuera de ±10 min (`mp.ts`) |
| C2 | Baja | Monto pagado no validado vs. precio del plan | Verificación ±5% en `applyApprovedPayment` |
| C3 | Baja | `console.log` del tick exponía userId + montos | Solo conteo agregado |
| C4 | Hardening | Sin cabeceras de seguridad HTTP | `headers()` en `next.config.ts` (nosniff, DENY, Referrer, Permissions) |

## Verificado como correcto (no re-tocar)

- Cripto AES-256-GCM: IV aleatorio único por cifrado, auth tag aplicado, clave validada.
- Trading real: doble candado (`BINANCE_USE_TESTNET=false` + `ALLOW_REAL_TRADING=true`).
- Auth: middleware + cada server action revalida `auth()` server-side.
- Ownership por `userId` en todas las acciones (sin IDOR).
- Endpoints públicos: `timingSafeEqual`, fail-closed, webhook re-consulta a MP.
- Idempotencia de pagos por `mpPaymentId` único.
- Validación zod + clamp server-side; sin inyección/XSS/SSRF.
- DB sin puertos en prod; contenedor sin root; `.env` fuera de git y de la imagen.

## Checklist de hardening pre-deploy (dinero real)

**Bloqueantes de código — TODOS aplicados ✅**
- [x] `binanceOrderId` → bigint
- [x] Serialización del tick (advisory lock)
- [x] Puerto 3000 solo en loopback
- [x] Anti-replay del webhook · validación de monto · headers

**Operación del VPS (pendiente, al deployar):**
- [ ] API keys reales de Binance: **retiros deshabilitados** + **IP allowlist al VPS** (requisito duro — mitiga el riesgo de que la clave de cifrado viva en el mismo host).
- [ ] `ENCRYPTION_KEY`/`POSTGRES_PASSWORD`/`CRON_SECRET`/`MP_*` nuevos en prod (no reusar dev); `chmod 600 .env`.
- [ ] Build de producción con credenciales **live** reales de Clerk y MP; rebuild al tocar cualquier `NEXT_PUBLIC_*`.
- [ ] Firewall UFW verificado con `nmap` externo (solo 22/80/443 abiertos).
- [ ] TLS con Caddy + HSTS activo antes de exponer nada.
- [ ] Backups `pg_dump` **cifrados** a almacenamiento externo + restore probado (contienen las API keys cifradas).
- [ ] Migraciones versionadas (nunca `push --force` en prod).
- [ ] Rate limiter → Redis solo si se pasa a multi-instancia.
