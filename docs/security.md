# Seguridad y autorización

## Límites de confianza

El navegador es un cliente no fiable. IDs, rutas, selectores, flags, preferencias locales y campos de Sanity no conceden acceso. La publishable key es pública. Ninguna clave administrativa forma parte del build.

| Identidad             | Alcance                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Sin sesión            | Login/recuperación; sin tablas privadas ni RPC editorial                                                |
| Perfil suspendido     | Sin perfil privado, restaurantes ni autorización editorial                                              |
| Sin membresía         | Perfil propio, sin datos de restaurante                                                                 |
| Staff activo          | Lectura del restaurante activo y sus módulos; sin edición editorial, roles o contratación               |
| Owner/manager activo  | Contenido si módulo contratado y activo; nombre del restaurante y activación de módulos concedidos      |
| Platform admin activo | Administración global mediante backend; contenido solo con restaurante activo y módulo concedido/activo |

No hay una política permisiva global para simplificar el desarrollo. No se usan metadatos JWT/user_metadata como autoridad comercial. platform_admin está en app_private, separado de membresías.

## SECURITY DEFINER

Todas las funciones privilegiadas fijan `search_path=''` y califican tablas/esquemas. No construyen SQL desde entradas de usuario (el único SQL dinámico es una lista constante de tablas al instalar triggers/RLS). La identidad normal siempre procede de auth.uid().

active_user/has_role/entitled e is_platform_admin evitan recursión RLS leyendo como propietario, devolviendo solo booleanos. has_role exige perfil y restaurante activos y membresía active, salvo administrador global explícito. `authorize_content` no acepta proyecto/dataset; devuelve solo una integración autorizada y no sensible después de todas las comprobaciones.

Se revoca ejecución de funciones al público/anónimo. Solo authenticated recibe las funciones mínimas. `admin_configure` solo service_role; valida además que el actor sea administrador global activo, comprueba restricciones de tablas y registra actor/acción/restaurante. No la expongas con una concesión de EXECUTE a authenticated.

## Privilegios de columnas

Un usuario puede actualizar su display_name, un owner/manager el name de su restaurante activo y enabled de un módulo contratado. No puede modificar role, status, restaurant_id, slug, granted, provider o IDs. Esas operaciones solo pasan por backend privilegiado. RLS filtra además cada fila. Las políticas de membresías no se consultan a sí mismas recursivamente.

## Editor y almacenamiento

- Verificación Auth en cada petición Edge y autorización PostgreSQL fresca, con sesión del usuario.
- Integración exclusiva por proyecto/dataset; el token se resuelve por integration.id en secretos backend.
- Tipos/operaciones permitidos cerrados. No acepta GROQ, endpoints o mutaciones arbitrarias del cliente.
- Validación Zod y de referencias contra el dataset autorizado. No referencias a borradores ni a documentos de otro tipo.
- Borradores primero. Guardar no modifica la publicación. Publicar comprueba dos revisiones y usa una transacción; conflicto 409 exige recargar/revisar, sin reintentos de escritura.
- Imágenes limitadas a JPEG/PNG/WebP, 8 MiB, firma de archivo y decodificación final por Sanity. Sin SVG, URL remota ni proxy de cargas arbitrarias. Cuerpo HTTP limitado mientras se lee.
- CORS de orígenes exactos; respuestas no-store; errores públicos sanitizados; ningún token/cabecera se imprime.
- CSP restrictiva, sin HTML editorial ejecutable, dependencias visuales mínimas y contraseñas gestionadas solo por Auth.

## Pruebas y límites

Los tests de RLS ejecutan el SQL real en PGlite con roles PostgreSQL de ensayo y auth.uid() equivalente. Cubren accesos cruzados, anónimos, staff, elevación, contratación, suspensiones y RPC administrativa. No sustituyen una prueba final del gateway/API real de Supabase.

Configura rate limits, MFA para administradores, SMTP, rotación de secretos, permisos mínimos Sanity, backups y monitorización con tu política operativa antes de producción. Los secretos nunca se leen para diagnosticar su valor. No se han configurado sistemas externos de auditoría o alertas en esta fase. La auditoría administrativa no equivale todavía a una auditoría editorial por usuario en Sanity: el token de servicio aparece como actor en su historial.
