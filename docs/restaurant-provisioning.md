# Fase 6 · Iteración 3 — alta integral de restaurantes

## Flujo

El panel **Administración → Crear un restaurante** es exclusivo de Super Admin. Recoge nombre, slug, email y rol editorial del cliente, release del template, preset visual, módulos y dominio opcional. El navegador no envía project IDs, repositorios, owners, tokens, scripts ni URLs de callbacks.

`restaurant-provisioning` registra un plan inmutable e idempotente y deriva dos UUID distintos para los trabajos hijos. Después:

1. invoca `sanity-provisioning` con la misma sesión Super Admin;
2. muestra una pausa recuperable para asignar y verificar al Administrator esperado en el proyecto Sanity real;
3. conserva restaurante e integración `pending` cuando Sanity termina;
4. invoca `astro-provisioning` con el release aprobado y la configuración almacenada;
5. queda en `awaiting` mientras GitHub ejecuta el bootstrap y devuelve evidencia OIDC;
6. al consultar de nuevo, verifica el trabajo Astro, Pages, deployment y website registrados;
7. prepara una invitación única, reutiliza un usuario Auth con el mismo email si ya existe o envía la invitación mediante Admin Auth;
8. crea la membresía owner/manager, activa el restaurante y cierra el trabajo en una transacción;
9. muestra la URL provisional de Pages y, si se solicitó dominio, las instrucciones DNS pendientes.

Cerrar el navegador no pierde el alta. La lista se carga desde PostgreSQL y permite continuar el seguimiento. La UI consulta automáticamente un trabajo `running/awaiting`; un fallo recuperable exige pulsar **Reintentar etapa segura**. Un conflicto o resultado ambiguo permanece en `manual_review` y no se repite.

## Seguridad y aislamiento

La Edge Function valida `auth.getUser()` e `is_platform_admin()`. Cada RPC `service_role` vuelve a comprobar al actor en `app_private.platform_administrators`. `restaurant_provisioning_jobs` no concede acceso a `authenticated`; el cliente invitado solo ve su restaurante, contenido, módulos concedidos, publicación, versión y dominio mediante las políticas tenant existentes.

El cliente no puede crear restaurantes, ejecutar ninguno de los tres aprovisionadores, seleccionar templates, modificar el preset global, conceder/activar módulos ni leer trabajos. Su rol permite contenido, carta, imágenes, precios, visibilidad y publicación cuando `content_management` está concedido y activo.

Los identificadores hijos se derivan del request y su contrato completo se fija con SHA-256. Un segundo `start` devuelve el mismo trabajo; cambiar datos con el mismo UUID se rechaza. Leases evitan ejecutores simultáneos. La finalización vuelve a comprobar que Sanity, Astro, `website_deployments` y `restaurant_websites` pertenecen a la misma tupla restaurante/integración. Ningún fallo borra proyectos, repositorios, usuarios o contenido.

## Invitaciones

`INVITE_REDIRECT_URL` debe ser HTTPS y apuntar a `/auth/update-password` del dashboard. Antes de enviar, SQL busca el email exacto en Auth. Esto permite continuar si el usuario ya existía o si una respuesta anterior fue incierta. Si el envío falla y Auth no registró al usuario, el trabajo queda recuperable; no existe un bucle automático. Un perfil suspendido no puede completar el alta.

## Dominio

El dominio es opcional y se clasifica explícitamente como `subdomain` o `apex`; no se intenta inferir el public suffix. Para subdominios se muestra un CNAME hacia `<owner>.github.io`. Para un apex se muestran los registros A/AAAA oficiales de GitHub Pages. La plataforma almacena `dns_pending`, pero no llama al registrador, no cambia CNAME y no afirma verificación o certificado. La activación del custom domain en Pages debe hacerse después de comprobar propiedad y propagación.

## Configuración pendiente antes de Burger House

En **Supabase → Edge Functions → Secrets**:

- `SANITY_PROVISIONER_TOKEN`
- `SANITY_PROVISIONING_ORGANIZATION_ID`
- `SANITY_EXPECTED_ADMIN_USER_ID`
- `APP_INTEGRATION_CREDENTIAL_ACTIVE_KEY=v1`
- `APP_INTEGRATION_CREDENTIAL_KEYS={"v1":"<clave-base64url-de-32-bytes>"}`
- `GITHUB_PROVISIONER_TOKEN`
- `GITHUB_REPOSITORY_OWNER=EduardoCR90`
- `GITHUB_TEMPLATE_REPOSITORY=EduardoCR90/restaurant-astro-template`
- `GITHUB_TEMPLATE_REPOSITORY_ID=1441667450`
- `GITHUB_INSTANCE_BOOTSTRAP_WORKFLOW=bootstrap-instance.yml`
- `GITHUB_INSTANCE_VISIBILITY=public` o `private` según el plan de Pages
- `INVITE_REDIRECT_URL=https://restaurant-platform-dashboard-xi.vercel.app/auth/update-password`

El repositorio `restaurant-astro-template` debe mantener activado **Template repository**. El token GitHub necesita acceso backend mínimo para generar repositorios desde ese template, despachar Actions y configurar Pages; el token Sanity debe poder crear proyectos/datasets/tokens en la organización indicada. No guardes estos valores en GitHub, Vercel, `.env` versionados o el chat.

Sin los cinco valores Sanity, identidad y cifrado, el endpoint registra la solicitud agregada como `failed/configuration`, no llama a proveedores y permite un reintento explícito después de corregir secretos. El workflow manual **Diagnose provisioning (read-only)** comprueba una solicitud existente y la presencia de esos nombres sin leer sus valores ni reintentarla. Las pruebas usan PGlite, adaptadores simulados y rutas Playwright; no crean recursos reales.
