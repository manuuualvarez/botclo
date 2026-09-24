# ADR-002 — Validar el acceso de trading antes del almacenamiento cifrado

Fecha: 2026-09-24. Complementa ADR-001. Reglas: [AGENTS.md](../../AGENTS.md).

## Contexto

Guardar/borrar claves y ejecutar robots deben compartir lock e invariantes de cuenta, entorno y exposición. El módulo existente de almacenamiento cifrado permanece intacto: el control local rechazó editarlo incluso después de la autorización de Manu.

## Decisión

`trading-access.ts` aplica las reglas de dominio y delega en las funciones existentes de persistencia. Todos los consumidores de lectura/rotación/desconexión pasan por esa capa. No se duplica criptografía ni se modifica el archivo protegido.

Antes de descifrar se comprueba el entorno. Rotar claves exige la misma identidad Binance para robots vinculados; un legado con exposición requiere comprobar también la cuenta anterior. La desconexión exige ausencia de exposición y órdenes pendientes. Las mutaciones adquieren el mismo advisory lock que el ejecutor.

## Alternativas y consecuencias

- Validaciones copiadas en cada action: evita el módulo, pero deja múltiples entradas de lectura y ejecución con reglas potencialmente distintas.
- Cambiar la persistencia cifrada: concentra el código, pero mezclaría allí las reglas de robots y requeriría modificar el archivo protegido.

La capa agrega una lectura de metadatos antes del descifrado. La verificación de identidad usa solamente consultas Binance; no emite órdenes. Las claves continúan almacenándose con el cifrado existente.

## Verificación

Seis tests de integración PostgreSQL con HTTP interceptado: entorno antes de descifrar, desconexión con exposición, rotación por UID, cuenta legacy con key revocada, aislamiento entre usuarios y exclusión mutua con un tick. Cinco fallaron antes de implementar las guardas; los seis pasan integrados.
