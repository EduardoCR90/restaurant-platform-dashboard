# Vercel y trabajo desde navegador

## Preparación de despliegue (sin desplegar en esta entrega)

1. Revisa e integra la PR solo cuando se autorice. Importa `EduardoCR90/restaurant-platform-dashboard` en Vercel; framework Vite, build `npm run build`, salida dist.
2. Configura únicamente las dos variables VITE_ de .env.example. El valor publishable es público. Nunca pongas service_role, contraseña PostgreSQL o token Sanity en Vercel para este frontend.
3. Configura antes la base y Edge de Supabase siguiendo supabase.md. CORS: origen exacto de Vercel; Auth: Site URL y destinos /auth/update-password. No habilites previews arbitrarios con acceso a producción.
4. Vercel proporciona HTTPS. vercel.json reescribe rutas SPA y añade CSP, no-store, frame denial, nosniff, referrer policy y permisos del navegador restringidos. Si cambias proyecto Supabase, actualiza connect-src al origen exacto; no uses comodín para simplificar.
5. Despliega solo después de autorización. Comprueba acceso directo y refresco en /content/page y /auth/update-password. Las rutas privadas son protegidas por sesión + perfil y la seguridad de datos por RLS/Edge.

La CI ejecuta lint, formato, TypeScript, SQL/RLS en memoria, unitarias/RTL, build, Deno check y Playwright con servicios de ensayo. No ejecuta migraciones remotas, no necesita secretos y no publica nada en Vercel, Pages o Sanity.

## Guía de validación móvil real

Con la configuración remota completada en un entorno de ensayo:

1. Abre el dominio HTTPS a 390px o desde un móvil. Una ruta privada sin sesión debe llevar a login; no debe haber scroll horizontal.
2. Inicia sesión con un usuario invitado real. Refresca y verifica persistencia. Prueba logout y acceso directo posterior: debe requerir login.
3. Prueba recuperación desde el email y fija una contraseña; comprueba que no se imprime ni permanece en la URL el token.
4. Selecciona Salitre de ensayo y, si tienes otra membresía, el segundo restaurante. Verifica que cambia el contenido y no queda el editor anterior en pantalla.
5. Abre módulos: contratación, activación y estado futuro deben distinguirse. Un staff o usuario sin módulo no debe entrar al editor ni usando su URL directa.
6. En un dataset de ensayo crea una página, añade/reordena varios bloques y guarda. Desde otra sesión modifica el mismo borrador y verifica el conflicto 409 al guardar/publicar la primera.
7. Publica el borrador y verifica su estado en Sanity. Edita categoría/plato, disponibilidad, visibilidad y precio. Prueba una imagen válida y una inválida.
8. Comprueba el flujo de reconstrucción de esa web de ensayo, manual o webhook ya autorizado. Publicar no equivale a que el despliegue haya terminado.
9. Prueba teclado, foco, cierre del menú móvil con Escape y movimiento reducido. Suspende usuario/restaurante desde administración y verifica que las siguientes operaciones se deniegan.

## Codex Cloud sin ordenador

Abre la PR para revisar cambios y resultados de Actions. Usa Supabase Dashboard para SQL revisado, Auth y Secrets. Para desplegar Edge desde Codex necesitas Supabase CLI/identidad autorizada en el entorno seguro; no pegues credenciales en el chat. Vercel puede importar el repositorio desde su navegador. Un build correcto en CI no demuestra que estén configuradas esas cuentas externas.

Si falta una identidad o secreto, continúa con código/tests y deja esa operación remota pendiente. Nunca conviertas una dependencia de configuración en un login de demostración de producto.
