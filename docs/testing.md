# Validación y limitaciones

## Capas de prueba

- **PostgreSQL aislado:** PGlite ejecuta la migración completa, roles PostgreSQL, auth.uid() de ensayo y políticas RLS reales. Comprueba aislamiento A/B, membresías, permisos por columna, administrador global, usuarios/restaurantes suspendidos, entitlement vs enabled e integración exclusiva. No es un test contra Supabase remoto ni su gateway.
- **Unidad editorial:** adaptador en memoria verifica borradores, publicación transaccional con dos revisiones, referencias, duplicados, campos preservados, tipos/IDs, errores y uploads. No accede a Sanity real.
- **RTL:** login, error, recuperación, cambio de contraseña, logout, rutas privadas, perfil suspendido, selección y orden de bloques. SDK sustituido solo en tests.
- **Playwright:** navegador Chromium, rutas privadas/recuperación móvil y selección → edición → guardado → publicación con endpoints Auth/REST/Edge interceptados. La UI de producto sigue usando servicios reales.
- **Build/tipos/lint:** React y Edge se comprueban por separado. CI también usa Deno real, no el shim local de tsc.

Consulta la ejecución enlazada en la PR para resultados exactos de CI. No se han ejecutado migraciones, invitaciones, escrituras editoriales ni despliegues remotos. No se acredita login real, SMTP real, publicación real desde Edge o reconstrucción pública por tests con mocks.

## Limitaciones de esta fase

- La colección editable se limita a 1000 documentos raw por tipo (publicado y borrador cuentan separados); supera ese límite con un error explícito, no truncando contenido silenciosamente. Incorporar paginación de servidor y búsqueda para catálogos mayores.
- El editor conserva campos desconocidos existentes, pero solo permite editar el contrato salitre-v1. Un segundo contrato requiere adaptador y pruebas. No hay editor WYSIWYG de arrastrar sobre la web pública.
- No hay merge automático ni comparación visual de revisiones; un conflicto exige recargar y revisar. La unicidad del slug se verifica antes de escribir; carreras entre creaciones simultáneas deben revisarse antes de publicar, Sanity no proporciona una restricción SQL UNIQUE de slugs.
- Existe aviso al cerrar/refrescar con cambios locales; navegar internamente sin guardar aún puede descartarlos. Guardar siempre antes de cambiar de documento/restaurante.
- Invitaciones requieren SMTP/redirects/secretos; no se han enviado emails de prueba en remoto. MFA, observabilidad, límites operativos y auditoría editorial individual son configuración/siguientes mejoras de producción.
- Los módulos de reservas, turnos, QR, eventos y analítica no tienen funcionalidad. Se muestran como pendientes y no se inventan datos.
- El webhook y los despliegues de webs públicas pertenecen a su infraestructura existente. Esta fase no los configura ni despliega.

## Siguientes comprobaciones necesarias

Aplicar SQL revisado en un Supabase de ensayo autorizado, configurar Auth/SMTP/Edge, proyecto Sanity de ensayo y token mínimo, asignar cuenta real y probar el recorrido completo. Después revisar permisos operativos y autorizar cualquier operación sobre producción. La fase no debe declararse operativa en producción hasta completar esa verificación.

## Resultado local del 31 de octubre de 2026

TypeScript de React y Edge, ESLint y Prettier: correctos. Vitest: 36 pruebas (13 de PostgreSQL/RLS) sin fallos. La build Vite genera chunks separados para React, Supabase, validación y editor. Rollup elimina dos anotaciones de comentarios de Zod; no son errores de compilación. Playwright valida los dos recorridos críticos con la API de ensayo; los resultados definitivos se vuelven a comprobar en la PR. No se han usado credenciales remotas de escritura.
