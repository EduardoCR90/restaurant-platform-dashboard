# Edge Functions: despliegue manual desde GitHub

Proyecto fijo: `wanrzgumoamryuybmopa`. Dashboard existente: https://restaurant-platform-dashboard-xi.vercel.app.

El workflow `.github/workflows/deploy-supabase.yml` **solo** se ejecuta con workflow_dispatch y desde main. Esta PR lo prepara; no se ha solicitado ni realizado un despliegue.

## Qué publica y qué necesita

- Supabase CLI **2.122.0**, versión fija instalada con la acción oficial supabase/setup-cli.
- Solo las funciones `content` y `platform-admin`, con nombres y proyecto explícitos en dos comandos consecutivos. No hay selección automática de funciones, `--prune`, enlace de base de datos ni comandos SQL.
- Token de administración de CLI desde el secreto de Actions `SUPABASE_ACCESS_TOKEN`, ya disponible según la configuración indicada. Solo se entrega a los dos pasos de despliegue, nunca a instalación, tests o prueba de empaquetado. No se imprime y no se envía como secreto del runtime Edge.
- `contents: read` para GITHUB_TOKEN, sin escritura de repositorio, OIDC o permisos de despliegue de webs. Checkout no persiste credenciales.
- Concurrencia común por proyecto, `cancel-in-progress: false`: no interrumpe un despliegue activo ni ejecuta otro simultáneamente. Los despliegues son secuenciales; no existe una transacción atómica entre ambas funciones.

Los secretos del runtime ya configurados en Supabase permanecen allí. Comprueba `ALLOWED_ORIGINS=https://restaurant-platform-dashboard-xi.vercel.app` (incluye otros orígenes solo si están autorizados), las claves públicas automáticas/APP_ y `SANITY_TOKENS` por integration.id. Este workflow no crea ni cambia secretos, usuarios, módulos, membresías o integraciones. Salitre debe seguir apuntando a `staging`; no ejecutes de nuevo bootstrap o migraciones para desplegar funciones.

## JWT y dependencias compartidas

`supabase/config.toml` declara `verify_jwt=false` y `import_map="./functions/deno.json"` para las dos funciones. El comando fija además `--no-verify-jwt` y `--import-map supabase/functions/deno.json`; el flag se refiere al gateway, **no** desactiva la autenticación de la aplicación. Cada función exige Bearer, valida el usuario con `auth.getUser` y aplica sus comprobaciones de rol/RLS. `content` resuelve el restaurante/módulo/integración y `platform-admin` verifica al administrador global antes de usar claves privilegiadas.

Se usa `--use-api`: la CLI recorre el grafo de imports locales y prepara los archivos para el bundler de Supabase, sin Docker ni servicios de base de datos. Los imports relativos a `supabase/functions/_shared/` y al `shared/` de la raíz se incluyen. El import map fija zod y el SDK de Supabase. No se copian secretos, node_modules ni código Astro/Studio al paquete.

El adaptador HTTP conserva la barrera de escrituras: solo dataset exactamente `staging`, antes de emitir una mutación o un upload. No hay flag en este workflow que habilite `production`.

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
3. Revisa los pasos de validación y los dos pasos individuales de deploy. Ambos deben finalizar correctamente. El resumen enlaza los datos del alcance, no contiene tokens.
4. En Supabase → Edge Functions, confirma que aparecen `content` y `platform-admin`, con fecha/versión actualizadas y verificación JWT de gateway desactivada. Las demás funciones no deben cambiar.
5. Desde el dashboard Vercel, sin sesión no debe existir acceso editorial; con usuario autorizado prueba lectura y, solo en `staging`, borrador/publicación. Sin Bearer válido las funciones deben devolver 401 (desde un origen permitido); un usuario sin permisos debe recibir 403. `platform-admin` debe denegar usuarios no globales.
6. Revisa los logs de ambas funciones sin registrar cabeceras o tokens. Comprueba CORS si el navegador falla antes de recibir una respuesta. No intentes una escritura real en production: los tests de seguridad verifican el bloqueo con HTTP sustituido.

Si falla un paso, revisa cuál de las dos funciones llegó a actualizarse antes de repetir manualmente. Un fallo de auth/token puede indicar permisos del PAT (edge_functions_write; los requisitos exactos se consultan en `supabase functions deploy --help` de la versión fijada). No añadas permisos SQL ni ejecutes migraciones para resolver un error de despliegue.
