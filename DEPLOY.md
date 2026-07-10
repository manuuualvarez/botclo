# Deploy

**La guía canónica de deploy vive en [README.md](README.md)** (secciones 3 a
6): VPS de Hostinger paso a paso, dominio, Clerk y MercadoPago en producción,
HTTPS con Caddy, checklist de dinero real y mantenimiento.

Complementos:

- [INFRA.md](INFRA.md) — plan de VPS recomendado, capacidad, costos, señales
  de alarma y backlog de optimizaciones de escala.
- [BUSINESS.md](BUSINESS.md) — modelo de negocios, cobranza y nota legal
  previa a cobrar.

> ⚠️ Recordatorio de esquema de base de datos: en producción NUNCA
> `drizzle-kit push --force` (puede descartar datos). Usar migraciones
> versionadas: `drizzle-kit generate` (commitear el SQL) + `drizzle-kit
> migrate`, siempre con backup previo.
