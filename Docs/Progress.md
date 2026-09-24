# Progreso

## 2026-09-24 — Polling durante la recreación de web en Coolify

- El preflight sigue rechazando servicios con contenedores ambiguos antes de modificar Coolify. Después de iniciar el deploy, la coexistencia transitoria del contenedor web viejo y el nuevo queda pendiente hasta que haya una única identidad verificable.
- Los IDs de todas las dependencias se comparan en cada polling, incluso durante esa coexistencia. Un cambio, desaparición o duplicación de DB/bot continúa siendo un error; la superposición persistente de web vence por timeout sin afirmar éxito.
- TDD ejecutado: tres regresiones fallaron con el parser original; luego **18 tests offline verdes**, incluyendo fixtures del listado Docker completo y verificación real del parser. Suite ejecutada con warnings tratados como errores y `git diff --check` limpio.
- La suite del helper también corre en CI de PR y main, con warnings tratados como errores, antes de los checks de la aplicación.
- Implementado, pendiente de validación. No se disparó un deploy ni se modificaron flags de Binance.

## 2026-09-24 — Deploy selectivo mediante Coolify

- El workflow manual conserva CI y build de la imagen por commit. Replica esa imagen en el registry local y ejecuta el helper del mismo SHA; la ausencia de credenciales SSH produce un fallo explícito.
- El helper Python, sin dependencias, lee la configuración privada local y actualiza únicamente `BOTCLO_WEB_IMAGE`. Solicita el arranque exclusivo de `web` mediante la API de Coolify; no modifica flags de trading, archivos de secretos ni el Compose anterior.
- Verifica la identidad local de la imagen, un único servicio web, su estado running/healthy cuando hay healthcheck, y que los IDs de los contenedores restantes no cambien. HTTP con error o token vacío impiden continuar; respuestas y credenciales nunca se imprimen.
- TDD ejecutado: primero fallo por helper ausente y luego por recreación entre listado/inspección; finalmente **13 tests offline verdes**, incluyendo endpoint selectivo, fallo HTTP, redacción de secretos, rechazo de redirects, token vacío, imagen incorrecta y cambio inesperado de la base. El workflow ejecuta esta suite antes de publicar la imagen. Verificación runtime de este flujo pendiente del primer deploy en Coolify.

## 2026-09-24 — Protección Binance y recuperación

- Estado del plan: **aprobado por Manu**. Implementación local en rama `codex/binance-protection`; cierre pendiente de validación.
- Plan: [SDD-001](Plans/SDD-001-proteccion-binance-y-recuperacion.md).
- Diagnóstico: revisión de ejecutor, lifecycle, persistencia, CI/CD y documentación oficial Binance; consultas públicas de capacidades y consulta READ ONLY agregada de posiciones en el VPS.
- Resultado: alcance definido para journal, conciliación, stop residente, controles, pruebas de caída y posterior reinstalación sin n8n.
- Manu decidió omitir Testnet: se mantienen verificaciones offline; no se afirma contrato online validado.

### Implementación local

- F1: migración versionada tolera las columnas legacy agregadas manualmente, backfill exacto e identidades estables; journal/fills transaccionales y deduplicados. CI verifica el mismo commit antes del deploy manual.
- F2: cliente Binance con IDs exactos, decimales nativos, firma, filtros del entorno, estados desconocidos y cancelReplace parcial. Conciliación previa, recuperación de política de stop y lock común para scheduler/acciones.
- F3: stop residente, trailing coordinado ONLY_NEW, stop ya cruzado ejecuta la salida de la política existente, pausados mantienen protección. Dust conserva cantidad/costo sin congelar ciclos nuevos. UI separa stop deseado/confirmado y expone revisión; bots con journal se archivan cuando no hay exposición.
- Adopción verifica órdenes/fills legados; no adjudica saldos ajenos. Preflight solo lectura y manifiesto externo antes del corte. Flag apagado por defecto; no hay retorno automático al ejecutor legado después de adoptar.

### Evidencia ejecutada

Runtime Node 24.19.0, dependencias del lockfile existente, sin nuevas dependencias.

- TDD: clientes, journal, engine, adopción y guardas fallaron primero por funcionalidad ausente; casos adversariales adicionales fallaron por JSON inválido, ejecución aceptada seguida de 429, snapshot de saldo viejo, cooldown y dust antes de sus correcciones.
- `pnpm test:trading`: **87 tests verdes** (cliente 28, engine 24, adopción 25, guardas puras 10).
- `pnpm test:trading:db`: **24 tests verdes**, PostgreSQL 17 exclusivo; migración desde DB vacía y legacy con ALTER manuales, backfill y reaplicación; seis pruebas nuevas de acceso a cuenta integradas con el almacenamiento real y HTTP interceptado.
- `pnpm test:trading:recovery`: crash real del proceso después de aceptación simulada, dos reinicios sin compra duplicada y dump/restore a otra DB, conservando contabilidad e identidad. Todo el exchange es un fixture offline. También se ejecutó el tick DCA real con HTTP interceptado: crash tras descargar velas y antes de la compra conserva la señal; dos reinicios compran una sola vez sin crear stop.
- `pnpm test:ci`: suite existente verde.
- `pnpm typecheck`, `pnpm exec eslint . --max-warnings=0`, `pnpm build` y `git diff --check`: ejecutados verdes, sin warnings observados.
- Auditoría independiente detectó y corrigió: rechazo incorrecto después de BUY aceptado, carrera fill/cancelReplace, planned de backup, saldo anterior a conciliación, stop ya cruzado, remanentes y vela consumida antes de persistir intención y client ID renombrado por Binance al cancelar.

### Pendientes explícitos

- **Bloqueo resuelto con separación de responsabilidades:** el hook rechazó editar `credentials.ts` incluso con autorización. El archivo quedó intacto; `trading-access.ts` valida entorno/cuenta/exposición bajo lock y delega en el almacenamiento existente. Todos sus consumidores están conectados a esta capa; seis tests de integración verifican el comportamiento. Ver [ADR-002](ADR/ADR-002-validacion-acceso-trading.md).
- No se verificó visualmente una sesión autenticada de la UI.
- Backup productivo externo realizado el 24/09/2026 a las 17:40 UTC: dump PostgreSQL, configuración privada y referencias de imágenes, con permisos restringidos y checksums. Restore real en PostgreSQL 17 sin red externa: migraciones nuevas y reaplicación exitosas; recuentos intactos y valores cifrados verificados sin imprimirlos. Los robots conservaron estado legacy y sus posiciones. La evidencia con datos operativos permanece fuera del repositorio público.
- [PR #12](https://github.com/manuuualvarez/botclo/pull/12) publicado. [CI de implementación](https://github.com/manuuualvarez/botclo/actions/runs/36036870740) verde, incluyendo recuperación de proceso y PostgreSQL real. La revisión automática de Claude no pudo ejecutarse por saldo insuficiente en Anthropic; no se considera una revisión aprobada. Deploy por GitHub autorizado por Manu y pendiente de ejecución. No se emitieron órdenes reales; falta la adopción operativa de posiciones y el posterior corte para reinstalar sin n8n. El deploy fija la imagen al SHA verificado, conserva imágenes anteriores y mantiene la adopción nativa apagada.
- Las pruebas locales no equivalen a validar Binance en vivo. [Runbook](Runbooks/migracion-vps.md) y [ADR-001](ADR/ADR-001-proteccion-residente-journal.md).
