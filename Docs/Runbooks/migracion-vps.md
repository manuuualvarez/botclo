# Protección y migración del VPS

La implementación no reinstala ni activa trading automáticamente. Manu decidió omitir Testnet; no se afirma verificación online. La instalación actual mantiene n8n hasta completar el corte posterior.

## Preparar Botclo

1. Mantener `BOT_NATIVE_PROTECTION_ENABLED=false` durante el despliegue inicial. Fijar la imagen por SHA, conservar la imagen anterior y la misma `ENCRYPTION_KEY`.
2. Exportar `pg_dump -Fc` de PostgreSQL, `.env`, los Compose y configuración de proxy a almacenamiento **fuera del VPS** con acceso restringido. Las claves cifradas de la DB son inútiles si se pierde `ENCRYPTION_KEY`. Conservar también secretos Clerk/MP/Telegram y `CRON_SECRET`; no publicarlos en Git ni logs.
3. Restaurar el dump en PostgreSQL aislado, sin scheduler, con egress Binance bloqueado. Verificar usuarios, bots, trades, suscripciones y que el descifrado funciona sin imprimir claves. Ejecutar la nueva migración allí. No usar `db:push` para el rollout.
4. Desplegar release con flag apagado; no revertir migraciones ni borrar columnas. Ejecutar desde el checkout de esa release el preflight de solo lectura:

   `node --env-file=.env --import tsx scripts/trading-preflight.mts --output /ruta-segura/preflight-antes.json`

   Requiere las dependencias de desarrollo de la release (tsx); la imagen standalone no las incluye. El manifiesto contiene IDs, nunca claves. Copiarlo fuera del VPS. Si falta historial o hay diferencias, resolverlas antes de adoptar ese robot.
5. **Activación operativa por Manu:** habilitar el flag en el entorno del servicio y recrear `web`. Los próximos ticks concilian el historial y solicitan stops reales cuando la estrategia los requiere. Esto coloca órdenes en Binance; revisar cada robot y la pestaña de órdenes abiertas de Binance.
6. Con todos los robots adoptados y sin estados pendientes, repetir preflight con `--require-protected --expected /ruta-segura/preflight-antes.json`. El manifiesto externo evita aceptar una base restaurada a la que le falten robots. Si hay DCA o posiciones sin stop por configuración, el comando bloquea el corte para que su tratamiento sea explícito. No se inventa una política de venta.

## Cortar y reinstalar después

1. Pausar señales desde Botclo: los stops confirmados de bots adoptados siguen en Binance. Detener el scheduler solo después de completar conciliación y verificar las órdenes remotas.
2. Generar dump final, manifiesto y archivos de configuración externos; restaurarlos nuevamente. Comparar identidades UUID/cuenta/entorno y recuentos. Conservar checksums y hora de corte. Confirmar recuperación de los otros proyectos y la IP de salida autorizada por las API keys.
3. El proyecto Docker `n8n` actual incluye Traefik compartido. No eliminarlo aisladamente mientras las webs dependen de él. Preparar los dominios/certificados del nuevo proxy y considerar los webhooks de los otros servicios antes del corte.
4. Reinstalar Ubuntu limpio e instalar Coolify en una ventana acordada; restaurar bases, secretos, servicios y dominios con scheduler apagado. Restaurar el snapshot completo antiguo también restauraría n8n: es rollback, no instalación limpia.
5. Verificar salud/HTTPS/Clerk/webhooks; arrancar conciliación con robots pausados. Si un stop se ejecutó durante el corte, importar sus fills sin duplicar efectos antes de reanudar señales.
6. Repetir preflight, guardar nuevo manifiesto fuera del VPS y reanudar los robots que Manu decida.

## Recuperación

- Una orden `unknown` se consulta por su client ID; no cambiarle el ID ni marcarla rechazada para forzar un reintento.
- `MANUAL:` implica evidencia incompatible/insuficiente. Recuperar la DB y el manifiesto correctos; no borrar cantidades ni atribuir el wallet completo a un robot.
- Tras la primera adopción no volver a una imagen anterior sin journal: podría vender encima del stop residente. El rollback compatible conserva el nuevo reconciliador y puede detener señales.
- El stop residente sigue expuesto a condiciones de ejecución del exchange. El trailing ATR deja de actualizarse durante la caída; no se promete precio de salida.
