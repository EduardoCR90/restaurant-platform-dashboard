# Fase 6 · Iteración 1 — aprovisionamiento automático de Sanity

## Alcance real

El flujo exclusivo de Super Admin crea una base editorial independiente para un restaurante nuevo:

1. registra una solicitud idempotente y un restaurante `pending`;
2. crea un proyecto en la organización Sanity configurada y persiste inmediatamente el ID real devuelto por el proveedor;
3. libera el lease y queda en `awaiting_sanity_admin` hasta que el operador asigne al usuario esperado como Administrator;
4. verifica desde Edge la identidad humana y los roles efectivos mediante `GET /v2025-07-11/access/project/{projectId}/users/{sanityUserId}?includeImpliedRoles=true`;
5. crea el dataset público `production` y un token `developer` limitado al proyecto;
6. cifra la credencial con AES-256-GCM y la vincula al UUID de integración;
7. registra `restaurant_integrations` y continúa automáticamente con Astro en el flujo integral.

No crea Studio, repositorio Astro, despliegue, DNS, usuario cliente, membresía, módulos ni selección de template. El [aprovisionador integral](restaurant-provisioning.md) coordina esas etapas y mantiene el restaurante `pending` hasta verificarlas. Esta función no importa contenido ni escribe documentos de Sanity.

El request parcial reutiliza las validaciones de restaurante e integración de `provisioningSpec` (contrato 1) y registra `content_contract=salitre-v1`. Al completarse, sus IDs/proyecto/dataset pueden incorporarse al plan completo de fase 5 sin convertir inputs del cliente en autoridad ni duplicar el modelo.

La implementación usa la [Projects API oficial](https://www.sanity.io/docs/http-reference/projects-api) para proyecto, dataset y token, fijada a `v2021-06-07`. La identidad y membresía usan la [Access API oficial](https://www.sanity.io/docs/http-reference/access-api), fijada a `v2025-07-11`. Al ser un proyecto por restaurante, el token `developer` queda aislado a ese proyecto. El dataset es público para conservar la lectura estática actual; el token nunca se usa ni se entrega en el navegador.

## Seguridad e idempotencia

`sanity-provisioning` valida el JWT con `auth.getUser`, exige `is_platform_admin()` y llama a RPCs `service_role` que repiten esa autorización. Los clientes no leen jobs, ciphertext ni configuración. El navegador solo puede pedir `verify_admin` para un trabajo que el servidor ya dejó en espera; no envía project ID, usuario esperado ni rol.

La clave `project_key` derivada del request conserva la idempotencia interna. No se envía como supuesto ID asignable a Sanity. `project_id` es el ID externo real devuelto por `POST /projects` y se almacena antes de liberar el lease. Repetir `start` devuelve el mismo job; `verify_admin` usa locks y leases, por lo que dos pulsaciones no avanzan dos veces. Una respuesta ambigua al POST permanece en `manual_review` para impedir proyectos duplicados.

La pausa no mantiene una Edge Function ejecutándose. Para continuar, el backend consulta el recurso **Users** de Access con el `sanityUserId` exacto de `SANITY_EXPECTED_ADMIN_USER_ID`. Sanity separa Users de Robots, así que un robot no puede satisfacer esta comprobación. La respuesta debe contener una membresía del mismo proyecto y `roleNames` debe incluir el nombre canónico `administrator`; `includeImpliedRoles=true` incorpora roles efectivos derivados. Un usuario inexistente o un rol Developer mantiene el job en `awaiting`; una respuesta incompleta, un error de autenticación o la falta de permiso `sanity.project.members.read` detiene el intento sin avanzar.

El endpoint antiguo `GET /projects/{id}?includeMembers=true` no se usa para identificar a la persona. Su `members[].id` representa la identidad de membresía dentro del proyecto, mientras que Access distingue el `sanityUserId` global del `resourceUserId` específico de cada proyecto. Comparar esos dos espacios de IDs provocaba verificaciones negativas aunque el usuario humano tuviera Administrator.

Los logs estructurados `sanity-provisioning.admin-verification` solo incluyen request y una categoría cerrada: `expected_user_not_found`, `administrator_role_missing`, `incomplete_response`, `authentication_error`, `permission_error` o `verified`. No incluyen ID de usuario, roles completos, perfiles, emails, tokens ni respuestas de Sanity.

Proyecto, organización y nombre se vuelven a comprobar antes de aceptar el recurso. Dataset y token se verifican antes de crear. Sanity solo revela la clave del token al crearlo: una etiqueta reservada ya existente o un resultado incierto pasa a `manual_review`; nunca se crea un segundo token. La base solo almacena AES-256-GCM con AAD ligado al UUID de integración. Salitre conserva `SANITY_TOKENS` y su integración existente.

## Configuración manual imprescindible

En **Supabase → Edge Functions → Secrets**, configura:

- `SANITY_PROVISIONER_TOKEN`: token de cuenta/organización con capacidad para crear proyectos y, en ellos, administrar datasets y tokens. No reutilices un token editorial de restaurante.
- `SANITY_PROVISIONING_ORGANIZATION_ID`: organización propietaria de los proyectos.
- `SANITY_EXPECTED_ADMIN_USER_ID`: ID estable del usuario de Sanity que debe quedar asignado al proyecto; se obtiene del perfil/Management API, no es el email ni un valor enviado por el dashboard.
- `APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY=v1`.
- `APP_INTEGRATION_CREDENTIAL_KEYS`: JSON `{"v1":"…"}` donde el valor es una clave aleatoria de 32 bytes codificada base64url. Guarda versiones antiguas durante una rotación.

Los cinco nombres forman una sola unidad de configuración. Tener únicamente el token y la organización no permite aprovisionar: el backend debe poder cifrar el token editorial antes de pedir a Sanity que lo cree. En el alta integral, `failed/configuration` durante la etapa `sanity` significa que el runtime vio alguno de estos cinco nombres ausente o inválido y **no llamó a la API de Sanity**. Los rechazos posteriores del proveedor se registran en el trabajo hijo como `credentials`, `permissions`, `billing_or_quota`, `connection` o `provider_response`.

Genera la clave fuera del repositorio, por ejemplo con Node 22:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

No pongas estos valores en Vercel, GitHub, `.env` versionados o el chat. `SUPABASE_ACCESS_TOKEN` solo despliega las funciones; no sustituye las credenciales anteriores. Sin ellas, el endpoint falla antes de crear la fila o llamar a Sanity. `status` continúa disponible para trabajos ya registrados.

La credencial de gestión debe pertenecer a un usuario con permisos suficientes en la organización. Los límites de proyectos, roles y facturación dependen del plan de Sanity. El flujo solicita el rol `developer`; su disponibilidad y coste dependen del plan, y deja que Sanity envíe su notificación administrativa normal al crear el token. Una denegación de permisos o cuota se registra como categoría segura y requiere corregir la cuenta/plan antes de un `retry` explícito.

## Operación y recuperación

El panel **Administración → Nuevo proyecto Sanity** aparece solo para Super Admin. Genera el `request_id`, permite consultar estado y solo muestra Reintentar si el servidor declara el fallo recuperable. Los estados son `running`, `awaiting`, `failed`, `manual_review` y `succeeded`; las etapas incluyen `queued`, `awaiting_sanity_admin`, `admin_verified`, `dataset_ready`, `credential_pending` y `completed`. `awaiting_sanity_admin` es una pausa normal, no un error ni un lease activo.

Antes de la primera creación real:

1. configura los cinco valores y comprueba la organización/plan en Sanity;
2. confirma que la migración `202611010002_sanity_provisioning.sql` y la función `sanity-provisioning` están desplegadas;
3. usa un nombre/slug de ensayo y conserva el `request_id` mostrado por el panel;
4. verifica el proyecto, `production`, la integración cifrada y el restaurante `pending`;
5. no repitas una solicitud `manual_review`: inspecciona primero la etiqueta `restaurant-platform-<integration UUID>`.

Para una solicitud existente fallida, ejecuta manualmente **Diagnose provisioning (read-only)** desde `main` e introduce su `request_id`. El workflow solo consulta las filas de estado y la presencia de los cinco nombres de configuración mediante la Management API; no imprime valores/digests, no crea recursos y no ejecuta `retry`. Los logs de Edge posteriores incluyen eventos JSON `provisioning.configuration` y `sanity-provisioning.failure` con request, etapa, categoría y nombres ausentes, pero nunca excepciones, respuestas, cabeceras, emails o credenciales.

Los tests sustituyen HTTP, tokens y cifrado con datos sintéticos. CI aplica PostgreSQL en memoria y empaqueta las Edge Functions contra una API local. Ninguna prueba consulta o crea proyectos reales. Integrar la PR despliega código y esquema aditivo; no ejecuta el endpoint de aprovisionamiento.

## Recuperación de Abre Tu Corazón

El conflicto observado quedó confirmado: Sanity creó `lvtvr3ef`, pero el contrato anterior comparó ese valor con la clave interna `ra138101d442db33`. La corrección deja de enviar o validar esa clave como ID externo. No se adopta automáticamente un proyecto encontrado por nombre.

[`ops/abre-tu-corazon-recovery/`](../ops/abre-tu-corazon-recovery/README.md) contiene un inventario de solo lectura, una reconciliación preferida y un reset de base como último recurso. La reconciliación exige comprobar manualmente nombre, organización y procedencia de `lvtvr3ef`, y valida los UUID exactos antes de guardar el ID y volver a la pausa. Ninguno de los scripts se ejecuta en CI, llama a Sanity, borra recursos externos o toca Salitre.

## Despliegue

1. Configura `SANITY_EXPECTED_ADMIN_USER_ID` en Supabase Edge Secrets.
2. Aplica `202611030001_hybrid_sanity_admin.sql`.
3. Despliega `sanity-provisioning` y `restaurant-provisioning` con el workflow existente.
4. Para la solicitud fallida de Abre Tu Corazón, ejecuta primero el inventario de solo lectura y usa la reconciliación solo después de validar el proyecto en Sanity Manage.
5. Asigna el usuario esperado como Administrator, pulsa **Verificar y continuar** y observa que el mismo flujo pasa a dataset, credencial Developer y Astro.
