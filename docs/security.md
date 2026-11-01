# Seguridad y autorización

## Límites de confianza

El navegador es un cliente no fiable. IDs, rutas, selectores, flags, preferencias locales y campos de Sanity no conceden acceso. La publishable key es pública. Ninguna clave administrativa forma parte del build.

| Identidad             | Alcance                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sin sesión            | Login/recuperación; sin tablas privadas ni RPC editorial                                                                |
| Perfil suspendido     | Sin perfil privado, restaurantes ni autorización editorial                                                              |
| Sin membresía         | Perfil propio, sin datos de restaurante                                                                                 |
| Staff activo          | Lectura del restaurante activo y sus módulos; sin edición editorial, roles o contratación                               |
| Owner/manager activo  | Contenido si módulo contratado y activo; nombre del restaurante; orden/visibilidad, sin diseño ni activación de módulos |
| Platform admin activo | Administración global mediante backend; contenido solo con restaurante activo y módulo concedido/activo                 |

No hay una política permisiva global para simplificar el desarrollo. No se usan metadatos JWT/user_metadata como autoridad comercial. platform_admin está en app_private, separado de membresías.

## SECURITY DEFINER

Todas las funciones privilegiadas fijan `search_path=''` y califican tablas/esquemas. No construyen SQL desde entradas de usuario (el único SQL dinámico es una lista constante de tablas al instalar triggers/RLS). La identidad normal siempre procede de auth.uid().

active_user/has_role/entitled e is_platform_admin evitan recursión RLS leyendo como propietario, devolviendo solo booleanos. has_role exige perfil y restaurante activos y membresía active, salvo administrador global explícito. `authorize_content` no acepta proyecto/dataset; devuelve solo una integración autorizada y no sensible después de todas las comprobaciones.

Se revoca ejecución de funciones al público/anónimo. Solo authenticated recibe las funciones mínimas. `admin_configure` solo service_role; valida además que el actor sea administrador global activo, comprueba restricciones de tablas y registra actor/acción/restaurante. No la expongas con una concesión de EXECUTE a authenticated.

## Privilegios de columnas

Un usuario puede actualizar su display_name, un owner/manager el name de su restaurante activo ; la activación de módulos es exclusiva de Super Admin mediante backend. No puede modificar role, status, restaurant_id, slug, granted, provider o IDs. Esas operaciones solo pasan por backend privilegiado. RLS filtra además cada fila. Las políticas de membresías no se consultan a sí mismas recursivamente.

## Editor y almacenamiento

- Verificación Auth en cada petición Edge y autorización PostgreSQL fresca, con sesión del usuario.
- Integración exclusiva por proyecto/dataset; el token se resuelve por integration.id en backend. Toda escritura HTTP y subida de assets exige staging, la tupla exacta de Salitre configurada, o una credencial cifrada aprovisionada cuya evidencia coincide con restaurante/integración/proyecto/production. Véanse [la política de Salitre](salitre-production.md) y el [aprovisionamiento](sanity-provisioning.md). No hay booleano global ni bypass de administrador.
- Tipos/operaciones permitidos cerrados. No acepta GROQ, endpoints o mutaciones arbitrarias del cliente.
- Validación Zod y de referencias contra el dataset autorizado. No referencias a borradores ni a documentos de otro tipo.
- Borradores primero. Guardar no modifica la publicación. Publicar comprueba dos revisiones y usa una transacción; conflicto 409 exige recargar/revisar, sin reintentos de escritura.
- Imágenes limitadas a JPEG/PNG/WebP, 8 MiB, firma de archivo y decodificación final por Sanity. Sin SVG, URL remota ni proxy de cargas arbitrarias. Cuerpo HTTP limitado mientras se lee.
- CORS de orígenes exactos; respuestas no-store; errores públicos sanitizados; ningún token/cabecera se imprime.
- CSP restrictiva, sin HTML editorial ejecutable, dependencias visuales mínimas y contraseñas gestionadas solo por Auth.

## Pruebas y límites

Los tests de RLS ejecutan el SQL real en PGlite con roles PostgreSQL de ensayo y auth.uid() equivalente. Cubren accesos cruzados, anónimos, staff, elevación, contratación, suspensiones y RPC administrativa. No sustituyen una prueba final del gateway/API real de Supabase.

Configura rate limits, MFA para administradores, SMTP, rotación de secretos, permisos mínimos Sanity, backups y monitorización con tu política operativa antes de producción. Los secretos nunca se leen para diagnosticar su valor. No se han configurado sistemas externos de auditoría o alertas en esta fase. La auditoría administrativa no equivale todavía a una auditoría editorial por usuario en Sanity: el token de servicio aparece como actor en su historial.

Las claves del runtime se resuelven en `_shared/environment.ts`. El cliente de usuario solo admite APP_SUPABASE_PUBLISHABLE_KEY, el default publishable automático o anon heredada; nunca una clave privilegiada. Las claves automáticas secret/service_role se resuelven solo tras la comprobación de administrador. Los tests usan valores ficticios y no consultan secretos ni escriben en Sanity.

## Seguimiento de publicaciones

Las nuevas tablas de metadatos tienen RLS. Solo el backend, tras authorize_content o un OIDC GitHub verificado y asociado al destino, puede escribirlas. No se usa service_role para editar Sanity. Configuración de repositorios, revisiones y seguridad del callback: [publicación y despliegues](publication-tracking.md).

La [consolidación de fase 5](template-governance.md) sustituye la antigua activación de módulos por clientes, separa diseño de contenido y protege todos los caminos de publicación de drafts privilegiados.

## Aprovisionamiento Sanity

El [servicio de fase 6.1](sanity-provisioning.md) exige Super Admin tanto en Edge como en una RPC `service_role`. Los clientes no pueden leer trabajos ni ciphertext. Las credenciales nuevas se cifran con AES-256-GCM y claves versionadas que solo existen en secretos Edge; Salitre conserva su mapa heredado. Los POST no se reintentan automáticamente y cualquier token de resultado incierto se detiene en revisión manual.
