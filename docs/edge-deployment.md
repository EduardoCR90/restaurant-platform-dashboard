# Edge Functions: despliegue manual desde GitHub

Proyecto fijo: `wanrzgumoamryuybmopa`. Dashboard existente: https://restaurant-platform-dashboard-xi.vercel.app.

El workflow `.github/workflows/deploy-supabase.yml` se ejecuta manualmente con `workflow_dispatch` desde main y también como workflow reutilizable tras la CI verde de main.

## Qué publica y qué necesita

- Supabase CLI **2.122.0**, versión fija instalada con la acción oficial supabase/setup-cli.
- Solo las funciones `content`, `platform-admin`, `publications` y `sanity-provisioning`, con nombres y proyecto explícitos en comandos consecutivos. No hay selección automática de funciones, `--prune`, enlace de base de datos ni comandos SQL.
- Token de administración de CLI desde el secreto de Actions `SUPABASE_ACCESS_TOKEN`, ya disponible según la configuración indicada. Solo se entrega a los pasos de despliegue, nunca a instalación, tests o prueba de empaquetado. No se imprime y no se envía como secreto del runtime Edge.
- `contents: read` para GITHUB_TOKEN, sin escritura de repositorio, OIDC o permisos de despliegue de webs. Checkout no persiste credenciales.
- Concurrencia común por proyecto, `cancel-in-progress: false`: no interrumpe un despliegue activo ni ejecuta otro simultáneamente. Los despliegues son secuenciales; no existe una transacción atómica entre funciones.

Los secretos del runtime ya configurados en Supabase permanecen allí. Comprueba `ALLOWED_ORIGINS=https://restaurant-platform-dashboard-xi.vercel.app` (incluye otros orígenes solo si están autorizados), las claves públicas automáticas/APP_ y `SANITY_TOKENS` por integration.id. Para habilitar el nuevo endpoint, configura también los cuatro secretos descritos en [aprovisionamiento Sanity](sanity-provisioning.md). El workflow no crea ni cambia secretos ni ejecuta solicitudes de aprovisionamiento. Salitre conserva su integración existente; no repitas bootstrap.

## JWT y dependencias compartidas

`supabase/config.toml` declara `verify_jwt=false` y `import_map="./functions/deno.json"` para las cuatro funciones. El comando fija además `--no-verify-jwt` y `--import-map supabase/functions/deno.json`; el flag se refiere al gateway, **no** desactiva la autenticación de la aplicación. Las peticiones de usuario exigen Bearer y validan el usuario con `auth.getUser`. `content` resuelve restaurante/módulo/integración, `platform-admin` y `sanity-provisioning` verifican administrador global, y los callbacks de `publications` validan OIDC registrado.

Se usa `--use-api`: la CLI recorre el grafo de imports locales y prepara los archivos para el bundler de Supabase, sin Docker ni servicios de base de datos. Los imports relativos a `supabase/functions/_shared/` y al `shared/` de la raíz se incluyen. El import map fija zod y el SDK de Supabase. No se copian secretos, node_modules ni código Astro/Studio al paquete.

El adaptador HTTP conserva la política de escritura existente: staging y la excepción exacta de Salitre production. Las integraciones nuevas usan proyecto independiente y credencial cifrada; el workflow no llama al proveedor ni crea recursos.

## Verificación sin desplegar

Antes de usar el token real, el workflow comprueba tipos/imports con Deno, los tests de variables/staging y el empaquetado. La CI de PR ejecuta también la comprobación de empaquetado; no recibe `SUPABASE_ACCESS_TOKEN`.

```bash
# Con CLI 2.122.0 instalada:
node scripts/check-edge-package.mjs
# O indicando la ruta al binario:
SUPABASE_CLI=/ruta/supabase node scripts/check-edge-package.mjs
```

La CLI no ofrece `functions deploy --dry-run`. Esta prueba utiliza la CLI real con su perfil incorporado `supabase-local` (API fija http://localhost:8080), un proyecto ficticio y un token ficticio, en una copia temporal sin .env. Un servidor local captura el multipart y comprueba cada archivo compartido, el import map y `verify_jwt=false`. No publica ni ejecuta funciones. No lee tokens del entorno del operador ni llama al proyecto real. Si localhost:8080 está ocupado, se detiene; no usa otro destino. La telemetría está deshabilitada.

Esta prueba verifica **el paquete de fuentes y sus metadatos**. Deno comprueba la resolución y tipos; el bundling final del servidor de Supabase y la ejecución remota solo se acreditan tras un despliegue autorizado. No confundir un paquete correcto con una publicación ya realizada.

## Ejecutar cuando se autorice

1. Revisa e integra la PR. El workflow no se dispara al fusionar; aparecerá en Actions cuando esté en main.
2. Abre **Actions → Deploy Supabase Edge Functions → Run workflow**, selecciona **main** y ejecuta manualmente. Elegir otra rama hace que el job se omita.
3. Revisa los pasos de validación y los cuatro pasos individuales de deploy. Todos deben finalizar correctamente. El resumen no contiene tokens.
4. En Supabase → Edge Functions, confirma las cuatro funciones, su fecha/versión y verificación JWT de gateway desactivada.
5. Sin Bearer válido deben devolver 401 desde un origen permitido; un usuario sin permisos debe recibir 403. `platform-admin` y `sanity-provisioning` deben denegar usuarios no globales.
6. Revisa logs sin registrar cabeceras, respuestas de proveedor o tokens. No ejecutes una creación real como prueba del despliegue; usa el procedimiento controlado de [fase 6.1](sanity-provisioning.md).

Si falla un paso, revisa qué funciones llegaron a actualizarse antes de repetir manualmente. Un fallo de auth/token puede indicar permisos del PAT (edge_functions_write; los requisitos exactos se consultan en `supabase functions deploy --help` de la versión fijada). No amplíes permisos SQL para resolver un error de despliegue.

## Política actual de Sanity

La iteración 2 añade la excepción de Salitre configurada por tupla exacta. [Configurar antes de activar production](salitre-production.md); las restricciones anteriores de staging describen la entrega inicial. No eliminar ni sustituir la integración existente.

## Fase 5: rollout validado

El despliegue manual sigue disponible. El workflow es también reutilizable desde `Roll out validated platform main`, que exige CI verde del main actual del mismo repositorio, aplica primero metadatos/permisos revisados y utiliza el SHA exacto validado. La llamada reutilizable conserva los mismos tests, CLI fija, cuatro funciones y secretos. No hay escrituras CMS, bootstrap ni llamadas de creación a Sanity.
