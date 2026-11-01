# Fase 6 · Iteración 1 — aprovisionamiento automático de Sanity

## Alcance real

El flujo exclusivo de Super Admin crea una base editorial independiente para un restaurante nuevo:

1. registra una solicitud idempotente y un restaurante `pending`;
2. crea un proyecto en la organización Sanity configurada;
3. crea el dataset público `production`;
4. genera un token `editor` limitado a ese proyecto dedicado;
5. cifra la credencial con AES-256-GCM y la vincula al UUID de integración;
6. registra `restaurant_integrations` y el estado final en una única transacción.

No crea Studio, repositorio Astro, despliegue, DNS, usuario cliente, membresía, módulos ni selección de template. El contrato de fase 5 sigue siendo la frontera del futuro aprovisionador completo. El restaurante permanece `pending` hasta que esas etapas posteriores se verifiquen. Esta iteración no importa contenido ni escribe documentos de Sanity.

El request parcial reutiliza las validaciones de restaurante e integración de `provisioningSpec` (contrato 1) y registra `content_contract=salitre-v1`. Al completarse, sus IDs/proyecto/dataset pueden incorporarse al plan completo de fase 5 sin convertir inputs del cliente en autoridad ni duplicar el modelo.

La implementación usa la [Projects API oficial](https://www.sanity.io/docs/http-reference/projects-api): `POST /projects`, `PUT /projects/{projectId}/datasets/production`, `GET/POST /projects/{projectId}/tokens`. La versión queda fijada a `v2021-06-07`. Al ser un proyecto por restaurante, el token `editor` queda aislado a ese proyecto. El dataset es público para conservar la lectura estática actual; el token nunca se usa ni se entrega en el navegador.

## Seguridad e idempotencia

`sanity-provisioning` valida el JWT con `auth.getUser`, exige `is_platform_admin()` y llama a RPCs `service_role` que vuelven a comprobar que el actor está en `app_private.platform_administrators` y tiene perfil activo. Un owner/manager cliente no tiene permisos de tabla ni ejecución de las RPCs. El cuerpo no acepta project ID, token, organización, email, template, módulos o dominio.

El `request_id` fija el trabajo y deriva un project ID estable; repetir `start` devuelve el mismo trabajo y un contrato diferente con el mismo ID se rechaza. Un lease de cinco minutos impide dos ejecutores simultáneos. `retry` siempre es explícito y solo se admite tras un fallo marcado como seguro o un lease vencido. No hay reintentos automáticos.

Proyecto y dataset se verifican antes de crearlos. Si se pierde la respuesta al crear el proyecto, la siguiente ejecución busca el ID determinista y comprueba nombre y organización. Sanity solo revela la clave de un token al crearlo: si ya existe la etiqueta reservada, se pierde la respuesta del POST, falla el cifrado o falla la transacción final, el trabajo pasa a `manual_review`. No se crea otro token ni se borra el existente. Un operador debe revisar el proyecto y rotar/reconciliar la credencial en una iteración controlada.

La base solo almacena ciphertext, IV, versión de clave e ID público del robot. AES-GCM usa como AAD el UUID de integración y la versión, por lo que copiar un ciphertext a otra integración no permite descifrarlo. `content` busca primero el almacén cifrado y conserva `SANITY_TOKENS` como fallback para Salitre. La escritura en production de un proyecto nuevo exige que esa credencial cifrada se haya resuelto y que sus cuatro identificadores coincidan; no existe un booleano global. Ninguna respuesta del endpoint incluye tokens, claves, leases, hashes internos o respuestas completas de Sanity.

## Configuración manual imprescindible

En **Supabase → Edge Functions → Secrets**, configura:

- `SANITY_PROVISIONER_TOKEN`: token de cuenta/organización con capacidad para crear proyectos y, en ellos, administrar datasets y tokens. No reutilices un token editorial de restaurante.
- `SANITY_PROVISIONING_ORGANIZATION_ID`: organización propietaria de los proyectos.
- `APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY=v1`.
- `APP_INTEGRATION_CREDENTIAL_KEYS`: JSON `{"v1":"…"}` donde el valor es una clave aleatoria de 32 bytes codificada base64url. Guarda versiones antiguas durante una rotación.

Genera la clave fuera del repositorio, por ejemplo con Node 22:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

No pongas estos valores en Vercel, GitHub, `.env` versionados o el chat. `SUPABASE_ACCESS_TOKEN` solo despliega las funciones; no sustituye las credenciales anteriores. Sin ellas, el endpoint falla antes de crear la fila o llamar a Sanity. `status` continúa disponible para trabajos ya registrados.

La credencial de gestión debe pertenecer a un usuario con permisos suficientes en la organización. Los límites de proyectos, roles y facturación dependen del plan de Sanity. El flujo usa `editor`, disponible en Free según la referencia oficial, y deja que Sanity envíe su notificación administrativa normal al crear el token. Una denegación de permisos o cuota se registra como categoría segura y requiere corregir la cuenta/plan antes de un `retry` explícito.

## Operación y recuperación

El panel **Administración → Nuevo proyecto Sanity** aparece solo para Super Admin. Genera el `request_id`, permite consultar estado y solo muestra Reintentar si el servidor declara el fallo recuperable. Los estados son `running`, `failed`, `manual_review` y `succeeded`; las etapas son `queued`, `project_ready`, `dataset_ready`, `credential_pending` y `completed`.

Antes de la primera creación real:

1. configura los cuatro secretos y comprueba la organización/plan en Sanity;
2. confirma que la migración `202611010002_sanity_provisioning.sql` y la función `sanity-provisioning` están desplegadas;
3. usa un nombre/slug de ensayo y conserva el `request_id` mostrado por el panel;
4. verifica el proyecto, `production`, la integración cifrada y el restaurante `pending`;
5. no repitas una solicitud `manual_review`: inspecciona primero la etiqueta `restaurant-platform-<integration UUID>`.

Los tests sustituyen HTTP, tokens y cifrado con datos sintéticos. CI aplica PostgreSQL en memoria y empaqueta las cuatro Edge Functions contra una API local. Ninguna prueba consulta o crea proyectos reales. Integrar la PR despliega código y esquema aditivo; no ejecuta el endpoint de aprovisionamiento.
