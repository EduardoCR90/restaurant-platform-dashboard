# Supabase: configuración explícita

Proyecto previsto: `wanrzgumoamryuybmopa`, URL `https://wanrzgumoamryuybmopa.supabase.co`. No se ha aplicado SQL ni creado usuarios en remoto.

## Variables

Frontend (públicas): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Copia .env.example a .env en desarrollo; en Vercel configura esas dos variables. Nunca pongas secretos con VITE_.

Backend: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase en Edge. Añade `SUPABASE_PUBLISHABLE_KEY`, `ALLOWED_ORIGINS` (orígenes exactos separados por coma), `SANITY_TOKENS` y, para invitar, `INVITE_REDIRECT_URL`. La clave de servicio solo se usa en platform-admin. No la copies al cliente ni a .env del frontend.

`SANITY_TOKENS` es un objeto JSON privado donde cada clave es el UUID real de una integración y cada valor su token Sanity write, limitado al proyecto/dataset correspondiente. Consulta el UUID en restaurant_integrations después del bootstrap. Configúralo en **Supabase → Edge Functions → Secrets** sin pegarlo en el chat. Rechazamos tokens en configuration JSON: la tabla solo acepta `{"schema":"salitre-v1"}`.

## Migración y exposición de API

1. Revisa `supabase/migrations/202610310001_platform.sql`. Incluye restaurantes, perfiles, membresías, derechos de módulos, activaciones, integraciones, invitaciones y auditoría privada. Todos los datos privados tienen RLS; solo se conceden los privilegios mínimos de tabla/columna/función.
2. Antes de ejecutar nada en remoto: backup y autorización explícita. Para un proyecto de ensayo nuevo puedes aplicar el archivo desde SQL Editor o `supabase db push` tras vincular ese proyecto. No se ejecuta en CI.
3. La exposición automática de tablas está deshabilitada en tu proyecto. Verifica en **Integrations/Data API** (o API Settings según la interfaz) que el esquema `public` y las tablas/RPC enumeradas estén expuestas; el SQL concede SELECT y UPDATE de columnas concretas. Nunca expongas `app_private`. Tener RLS activado no sustituye los grants ni la exposición de API.
4. No uses service_role para “arreglar” errores de permisos en el navegador. Comprueba los grants y las políticas.

## Inicialización de Salitre

Ejecuta `supabase/bootstrap-salitre.sql` solo después de aprobarlo. Crea Salitre active, módulo de contenido contratado/activo e integración hfa8zkyw/production. No escribe en Sanity ni incluye credenciales. Si Salitre ya existe se detiene; no sobrescribe configuraciones.

Crea/invita al primer usuario real desde Auth en Supabase. El trigger crea su perfil; nunca se asignan privilegios desde user_metadata o por ser el primer usuario. En SQL Editor, como operador privilegiado, revisa el UUID real y ejecuta explícitamente:

```sql
insert into app_private.platform_administrators(user_id)
values ('UUID_REAL_DEL_USUARIO');
```

Después, el administrador global puede gestionar restaurantes/membresías/módulos en el dashboard. Para asignar un propietario existente desde SQL, usa `admin_configure` con el UUID real del actor global y del usuario; no uses ejemplos con correos ficticios ni contraseñas en scripts. El administrador global no necesita membresía ordinaria para administrar; para un propietario sí se necesita membresía active.

## Auth

- Deshabilita nuevos registros públicos en Auth → Providers/Settings (la UI no incluye signup). `supabase/config.toml` también lo deshabilita en local.
- Site URL: dominio Vercel definitivo. Redirect allowlist: `https://DOMINIO/auth/update-password`, y localhost solo en desarrollo. Autoriza cada dominio de preview que realmente uses, sin comodines amplios.
- Configura SMTP y plantillas de recuperación/invitación; revisa límites de envío y CAPTCHA/rate limits adecuados antes de producción. La clave pública no habilita cuentas ficticias.
- El cliente usa PKCE y recuperación de sesión de la URL. Para solicitudes enviadas desde otro dispositivo, PKCE requiere el contexto que inició el flujo; abre el enlace en el mismo navegador. Para invitaciones y recuperación entre dispositivos, usa plantillas con `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite` (o `type=recovery`). La aplicación verifica el token con verifyOtp y lo retira inmediatamente de la URL. Estas plantillas evitan depender del verificador PKCE del navegador que inició la solicitud. Comprueba el enlace en un navegador real tras desplegar.
- Perfil suspendido: Auth puede conservar un token temporal, pero las políticas/RPC y el guard de perfil bloquean los datos inmediatamente. Suspender membresía bloquea ese restaurante; suspender profile bloquea todos.

## Edge Functions

Desde una terminal segura con Supabase CLI autenticada al proyecto correcto:

```bash
supabase functions deploy content --project-ref wanrzgumoamryuybmopa
supabase functions deploy platform-admin --project-ref wanrzgumoamryuybmopa
```

Los imports alcanzan `shared/` desde las funciones. `deno.json` fija dependencias npm. `verify_jwt=false` es intencional para compatibilidad con claves publishable/JWT modernos: cada handler exige Bearer y verifica con `auth.getUser`; no hay rutas de datos sin autenticar. No despliegues una versión que omita esa comprobación. CORS exige ALLOWED_ORIGINS y rechaza por defecto.

Prueba primero un Supabase y Sanity de ensayo. No apuntes las pruebas de escritura a hfa8zkyw/production. La fase no está validada en remoto hasta que estos pasos se ejecuten y se compruebe login → membresía → módulo → lectura → borrador → publicación.

## Operaciones administrativas

La UI Administration existe solo para administrador global; el backend verifica de nuevo. Permite crear restaurantes, asignar/suspender membresías, conceder/revocar derechos de módulos, configurar una integración, cambiar estado e invitar. No permite conceder privilegios globales; eso requiere la operación SQL explícita anterior.

Las invitaciones registran el estado, envían email mediante Supabase Auth y asignan la membresía con una RPC privilegiada. Si el email o la membresía falla, no se reintenta ciegamente; se registra failed y un administrador revisa el resultado. SMTP, redirect y permisos requieren configuración. No se ha enviado ninguna invitación real.
