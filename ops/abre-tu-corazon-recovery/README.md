# Recuperación controlada de Abre Tu Corazón

Estos archivos no se ejecutan en CI ni realizan llamadas remotas. `inspect.sql` es de solo lectura. La ruta recomendada es `reconcile-existing-project.sql`: conserva `lvtvr3ef`, registra ese ID real en el job fallido y devuelve el flujo a `awaiting_sanity_admin`. Antes de ejecutarlo, un operador debe comprobar en Sanity Manage que `lvtvr3ef` se llama **Abre Tu Corazón**, pertenece a `op2ejysrx` y procede de esta solicitud.

Ejecuta cada mutación dentro de una transacción PostgreSQL administrativa: `BEGIN`, después `SET LOCAL app.abre_tu_corazon_confirmation='…'`, ejecuta el archivo con `\i`, revisa sus consultas finales y solo entonces usa `COMMIT` (o `ROLLBACK`). Los archivos no abren ni confirman la transacción por sí solos. Los scripts verifican request, restaurante, integración, slug, clave determinista y ausencia de adopción previa.

`reset-database-only.sql` es un último recurso destructivo. Rechaza cualquier dependencia posterior y nunca elimina el proyecto Sanity. Solo se puede usar tras decidir por separado qué hacer con `lvtvr3ef`; de lo contrario, una solicitud nueva crearía un proyecto duplicado. Ningún script toca Salitre y ambos comprueban su evidencia antes de modificar.
