# Botclo — Tus robots de inversión en cripto

SaaS para asesorar a clientes de Binance: cartera en vivo con gráficos,
perfil de inversor, 8 estrategias de trading explicadas en criollo,
backtesting honesto sobre precios históricos reales, robots de trading
automático (hasta 5 por usuario, con stop loss y trailing), avisos por
Telegram, panel de administración y monetización por suscripción con
MercadoPago. Pensado para usuarios NO técnicos: todo con guías paso a paso.

**Stack**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 +
shadcn/ui · three.js · PostgreSQL 17 + Drizzle · Clerk (auth) · MercadoPago
(pagos) · Docker.

**Documentos hermanos**: [AGENTS.md](AGENTS.md) (arquitectura y convenciones)
· [BUSINESS.md](BUSINESS.md) (modelo de negocios) · [INFRA.md](INFRA.md)
(capacidad y costos del VPS).

---

## Índice

1. [Desarrollo local](#1-desarrollo-local)
2. [QA de pagos en sandbox (MercadoPago)](#2-qa-de-pagos-en-sandbox-mercadopago)
3. [Deploy a un VPS de Hostinger](#3-deploy-a-un-vps-de-hostinger)
4. [Comprar y conectar un dominio](#4-comprar-y-conectar-un-dominio)
5. [Pasar a dinero real](#5-pasar-a-dinero-real-la-decisión-grande)
6. [Mantenimiento](#6-mantenimiento)

---

## 1. Desarrollo local

**Requisitos**: Docker Desktop corriendo, Node 20+, pnpm.

```bash
git clone <tu-repo> botclo && cd botclo
cp .env.example .env        # completar valores (ver comentarios del archivo)
pnpm install
pnpm dev                    # levanta web + Postgres + scheduler en Docker
```

La app queda en **http://localhost:3000** con hot-reload. Primera vez:
crear las tablas con `pnpm db:push:docker`.

Comandos útiles:

| Comando | Qué hace |
|---|---|
| `pnpm dev` / `pnpm dev:down` | levanta / baja el stack de desarrollo |
| `pnpm db:push:docker` | aplica cambios de `src/db/schema.ts` a Postgres |
| `pnpm build` / `pnpm lint` | verificación rápida local |
| `pnpm prod` | build+up de producción (lo que corre el VPS) |

**Onboarding de prueba**: creá tu cuenta en la app → conectá Binance con una
clave del [Spot Testnet](https://testnet.binance.vision) (login con GitHub →
botón **«Generate HMAC_SHA256 Key»**, ¡no la RSA!) → hacé el quiz de perfil →
simulá estrategias → creá un robot. Todo con fondos ficticios
(`BINANCE_USE_TESTNET=true`).

---

## 2. QA de pagos en sandbox (MercadoPago)

### El modelo de credenciales de MP (para no perderse)

Regla de oro de MP: **nunca mezclar mundos**. Si una parte es de prueba,
TODAS deben serlo — si no, el checkout corta con *"una de las partes con la
que intentás pagar es de prueba"*.

| Uso | Aplicación | Token para `.env` |
|---|---|---|
| **QA local (sandbox)** | La app de la **cuenta de prueba vendedora** (`Norte-Inversiones`) | Sus «credenciales de producción» (`APP_USR-…-2979949819`) — mueven plata ficticia porque toda la cuenta es de prueba |
| **Producción (VPS)** | **NorteInversiones** (cuenta real de Manuel) | Sus credenciales de producción reales |

- Las credenciales `TEST-…` de la app real **no sirven** para probar el
  checkout de punta a punta (solo para tests de API directa con tarjetas):
  producen el error de mezcla de arriba.
- En QA, quien paga es siempre la **cuenta compradora de prueba** de abajo,
  logueada en el checkout — jamás tu cuenta real ni una tarjeta real.

### Cuenta compradora de prueba (dinero 100% ficticio)

> ⚠️ Las credenciales de la cuenta compradora de prueba (usuario, contraseña,
> email) **NO se versionan** — este repo es público. Se generan y consultan
> desde el panel de MercadoPago → app **NorteInversiones** → **Cuentas de
> prueba**. El email de esa cuenta (formato `test_user_…@testuser.com`) va en
> `MP_TEST_PAYER_EMAIL` del `.env`: el checkout de **suscripciones** lo exige
> como pagador al crearlas (el pago único anual no lo necesita).

### Tarjetas de prueba (Argentina)

| Tarjeta | Número | CVV | Vencimiento |
|---|---|---|---|
| Mastercard | `5031 7557 3453 0604` | 123 | 11/30 |
| Visa | `4509 9535 6623 3704` | 123 | 11/30 |
| American Express | `3711 803032 57522` | 1234 | 11/30 |
| Mastercard débito | `5287 3383 1025 3304` | 123 | 11/30 |

El **nombre del titular** controla el resultado del pago (y el DNI: `12345678`):

| Titular | Resultado |
|---|---|
| `APRO` | ✅ Aprobado |
| `OTHE` | ❌ Rechazo general (ideal para probar la máquina de cobranza) |
| `FUND` | ❌ Fondos insuficientes |
| `SECU` | ❌ CVV inválido |
| `EXPI` | ❌ Fecha de vencimiento inválida |
| `CONT` | ⏳ Pago pendiente |

### El circuito de QA completo

1. En la app: **Mi plan → Botclo Real → Mensual** (o Anual).
2. En el checkout de MP: iniciar sesión con la **cuenta compradora** de
   arriba.
3. Pagar con saldo de la cuenta o una tarjeta de prueba (titular `APRO`).
4. **Peculiaridad del QA local**: el "Volver a la tienda" te deja en el
   dominio del túnel, deslogueado (la sesión de Clerk vive en localhost). Es
   esperable y no pasa en producción. Ignoralo y abrí a mano:
   `http://localhost:3000/dashboard/plan?vuelta=1` — la sincronización pull
   consulta el pago a MP y activa el plan.
5. Verificar: suscripción activa en "Mi plan", y en **/admin**: MRR,
   suscripción activa y detalle (próximo cobro/vencimiento) en Usuarios.

---

## 3. Deploy a un VPS de Hostinger

### 3.1 Comprar el VPS

1. [hostinger.com.ar → VPS](https://www.hostinger.com.ar/vps-hosting) →
   plan **KVM 2** (2 vCPU / 8 GB — alcanza hasta ~1.000 usuarios, ver
   INFRA.md). Facturación anual = mejor precio.
2. Al configurarlo elegí **Ubuntu 24.04** (sin panel), datacenter más
   cercano (São Paulo suele ser el de menor latencia desde Argentina), y
   guardá la **contraseña root** y la **IP** que te asigna.

### 3.2 Preparar el servidor

```bash
ssh root@TU_IP
# Docker (incluye compose):
curl -fsSL https://get.docker.com | sh
# Firewall: solo SSH, HTTP y HTTPS
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable
```

### 3.3 Subir el proyecto y configurar

```bash
git clone <tu-repo> botclo && cd botclo
cp .env.example .env
nano .env
```

Valores de **producción** en `.env`:

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://botclo.com` |
| `POSTGRES_PASSWORD` | nueva y fuerte: `openssl rand -hex 16` |
| `DATABASE_URL` | misma contraseña, host `db` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | `pk_live_…` / `sk_live_…` (ver 3.4) |
| `BINANCE_USE_TESTNET` | `true` al principio (¡sí, también en el VPS!) |
| `ENCRYPTION_KEY` | **nueva**: `openssl rand -hex 32` — no reusar la de dev |
| `CRON_SECRET` | **nuevo**: `openssl rand -hex 24` |
| `ADMIN_EMAILS` | tu email |
| `MP_ACCESS_TOKEN` | el de **producción** de NorteInversiones (`APP_USR-…`) |
| `MP_WEBHOOK_SECRET` | ver 3.5 |
| `MP_TEST_PAYER_EMAIL` | **VACÍO** (solo se usa en sandbox) |

### 3.4 Clerk en producción

1. En [dashboard.clerk.com](https://dashboard.clerk.com) → tu app → crear la
   instancia de **Production** con tu dominio.
2. Cargar los registros DNS que Clerk pida (CNAMEs — ver sección 4).
3. Copiar `pk_live_…` y `sk_live_…` al `.env`.

### 3.5 MercadoPago en producción

1. Panel de la app **NorteInversiones** → **Credenciales de producción** →
   copiar el Access Token (`APP_USR-…`) al `.env`.
2. Panel → **Webhooks** → configurar la URL
   `https://botclo.com/api/mp/webhook` (eventos: pagos y suscripciones)
   → copiar la **clave secreta** generada a `MP_WEBHOOK_SECRET`.

### 3.6 Levantar

```bash
docker compose up -d --build     # web + bot + db
docker compose exec web npx drizzle-kit push   # tablas (primera vez)
docker compose ps                # los 3 servicios "running"
docker compose logs -f web       # sin errores al arrancar
```

> ⚠️ Cambios de esquema posteriores en producción: NUNCA `push --force`.
> Usar migraciones versionadas (`drizzle-kit generate` + `migrate`) con
> backup previo.

### 3.7 HTTPS con Caddy (automático)

```bash
docker run -d --name caddy --restart unless-stopped \
  --network botclo_default -p 80:80 -p 443:443 \
  -v caddy_data:/data caddy:latest \
  caddy reverse-proxy --from botclo.com --to web:3000
```

Después quitá el mapeo `3000:3000` de `docker-compose.yml` para que la app
solo sea accesible por HTTPS, y `docker compose up -d`.

---

## 4. Comprar y conectar un dominio

### 4.1 Comprar en Hostinger

1. [hPanel → Dominios → Comprar dominio](https://hpanel.hostinger.com) →
   buscá el nombre (`.com` ~US$ 10-15/año; `.com.ar` se registra aparte en
   [nic.ar](https://nic.ar) con trámite AFIP).
2. Al comprarlo, activá la **privacidad WHOIS** (gratis en Hostinger).

### 4.2 Apuntarlo al VPS

En hPanel → tu dominio → **DNS / Nameservers** → registros:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `@` | IP de tu VPS | 300 |
| A | `www` | IP de tu VPS | 300 |
| CNAME | *(los que pida Clerk en 3.4)* | … | 300 |

La propagación tarda de minutos a un par de horas
([dnschecker.org](https://dnschecker.org) para verificar). Caddy emite el
certificado HTTPS solo cuando el dominio ya resuelve a tu IP.

### 4.3 Qué actualizar cuando el dominio está activo

1. `.env` del VPS: `NEXT_PUBLIC_APP_URL=https://botclo.com`.
2. `docker compose up -d --build` (las `NEXT_PUBLIC_*` se hornean en el
   build — siempre rebuildear al cambiarlas).
3. Clerk: verificar que la instancia de producción dé todos los DNS en verde.
4. MercadoPago: webhook apuntando al dominio (3.5) — los `back_url` del
   checkout salen solos de `NEXT_PUBLIC_APP_URL`.
5. Probar el circuito completo con el dominio real.

---

## 5. Pasar a dinero real (la decisión grande)

Checklist previo — no saltearse ninguno:

- [ ] Todo el QA en el VPS funcionando en modo práctica por al menos una semana
- [ ] Robot corriendo en testnet sin errores en ese período
- [ ] Consulta legal hecha (CNV/PSAV + botón de arrepentimiento — ver BUSINESS.md)
- [ ] Backups automáticos configurados y **restore probado**

Cuando decidas:

1. En Binance real: API key con **lectura + trading spot, SIN retiros**,
   restringida a la IP del VPS.
2. `.env`: `BINANCE_USE_TESTNET=false` y `ALLOW_REAL_TRADING=true`.
3. `docker compose up -d --build`.
4. Los usuarios (incluido vos) reconectan su cuenta con claves reales — las
   del testnet dejan de servir y la app lo indica.
5. Robot con presupuesto CHICO (ej: 50 USD) y observarlo unos días.

---

## 6. Mantenimiento

```bash
docker compose logs -f web                     # logs de la app
docker compose exec db pg_dump -U norte norte | gzip > backup_$(date +%F).sql.gz
docker compose up -d --build                   # deploy de una nueva versión
```

- **Backups**: `pg_dump` nocturno a Backblaze B2/Cloudflare R2 (~US$ 0,10/mes)
  + probar el restore una vez por trimestre. Detalle en INFRA.md.
- **Señales de alarma** (weight de Binance, duración del tick, RAM):
  tabla completa en INFRA.md.
- **Retención de snapshots**: programar la limpieza cuando la tabla pase
  1 GB (INFRA.md).

<!-- test: diagnóstico del workflow Claude Review -->
