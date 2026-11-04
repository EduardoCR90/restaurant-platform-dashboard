# Recuperación controlada de Abre Tu Corazón

## Sanity (completado)

Estos archivos no se ejecutan en CI ni realizan llamadas remotas. `inspect.sql` es de solo lectura. La ruta recomendada es `reconcile-existing-project.sql`: conserva `lvtvr3ef`, registra ese ID real en el job fallido y devuelve el flujo a `awaiting_sanity_admin`. Antes de ejecutarlo, un operador debe comprobar en Sanity Manage que `lvtvr3ef` se llama **Abre Tu Corazón**, pertenece a `op2ejysrx` y procede de esta solicitud.

Ejecuta cada mutación dentro de una transacción PostgreSQL administrativa: `BEGIN`, después `SET LOCAL app.abre_tu_corazon_confirmation='…'`, ejecuta el archivo con `\i`, revisa sus consultas finales y solo entonces usa `COMMIT` (o `ROLLBACK`). Los archivos no abren ni confirman la transacción por sí solos. Los scripts verifican request, restaurante, integración, slug, clave determinista y ausencia de adopción previa.

`reset-database-only.sql` es un último recurso destructivo. Rechaza cualquier dependencia posterior y nunca elimina el proyecto Sanity. Solo se puede usar tras decidir por separado qué hacer con `lvtvr3ef`; de lo contrario, una solicitud nueva crearía un proyecto duplicado. Ningún script toca Salitre y ambos comprueban su evidencia antes de modificar.

## Astro (pendiente de ejecución operativa)

La evidencia pública revisada el 4 de noviembre de 2026 identifica el repositorio existente como `EduardoCR90/abretucorazon-restaurant`, ID `1444959693`, público, rama `main`, y con `template_repository.id=1441667450` (`EduardoCR90/restaurant-astro-template`). Contiene un único commit inicial y el workflow `.github/workflows/bootstrap-instance.yml`. Su árbol Git `5b2729b1c3712c27ac2cd4e0f9f4666e14bdc5b6` coincide exactamente con el commit aprobado del template `a2c059b77813e32dba8418f8294e1faecee51b76`. El job sigue sin `repository_id`, por lo que no se debe crear ni reinicializar otro repositorio.

Antes de cualquier cambio, ejecuta `inspect-astro.sql` y confirma otra vez, mediante consultas de solo lectura, los campos cerrados que usa el backend:

```bash
gh api repos/EduardoCR90/abretucorazon-restaurant \
  --jq '{id,full_name,owner:.owner.login,private,default_branch,template_repository:(.template_repository|{id,full_name})}'
gh api repos/EduardoCR90/abretucorazon-restaurant/actions/workflows \
  --jq '[.workflows[]|{name,path,state}]'
```

El resultado debe mantener ID `1444959693`, propietario `EduardoCR90`, `private=false`, rama `main` y plantilla `1441667450`. Si falta o cambia cualquier dato, detente. No basta con que el nombre coincida.

Después de fusionar y desplegar la corrección de Edge, un operador puede preparar **un único reintento manual**:

```sql
begin;
set local app.abre_tu_corazon_confirmation='RECONCILE-ASTRO-1444959693';
\i ops/abre-tu-corazon-recovery/reconcile-existing-astro-repository.sql
-- revisar las dos consultas finales
commit; -- usar rollback ante cualquier diferencia
```

El script es idempotente, limita todos los UUID y conserva Sanity completado. Solo transforma los dos estados `manual_review` en `failed/retryable`; no registra el ID por confianza en SQL. Al pulsar **Reintentar** una sola vez desde el dashboard, la Edge Function vuelve a leer GitHub, exige la procedencia exacta, registra `repository_id` y el hash de especificación en el checkpoint, y despacha el bootstrap. Después, OIDC, manifiesto, Pages y el coordinador general mantienen sus verificaciones existentes.

No ejecutes el SQL ni el reintento antes del despliegue de la corrección. Ningún archivo de esta carpeta llama a GitHub/Sanity, modifica contenido editorial, toca Salitre o ejecuta por sí mismo una operación remota.
