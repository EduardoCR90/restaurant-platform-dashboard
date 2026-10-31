# Iteración 3 — Guardar, publicar, descartar y retirar

El flujo real Dashboard → Sanity production → Astro ya fue validado manualmente por el propietario al cerrar la iteración 2. Esta iteración lo conserva; no crea infraestructura, migraciones, datasets ni modelos paralelos.

## Acciones

- **Guardar borrador:** persiste en `drafts.<id>` sin cambiar la versión publicada. Los cambios locales se distinguen del borrador ya guardado.
- **Publicar cambios:** publica el draft guardado con comprobación de ambas revisiones. El mensaje confirma Sanity; la web cambia al reconstruirse. No acredita que el despliegue haya terminado.
- **Descartar cambios:** confirma la pérdida del borrador y de cambios locales. Si hay publicación, solo elimina el draft y vuelve a leer la versión publicada, sin modificarla. Para un documento nunca publicado, elimina únicamente su draft y vuelve al listado. Si solo hay cambios locales, los restablece sin llamar al backend. No borra assets.
- **Retirar de publicación:** confirma y parchea exclusivamente `visible=false` en plato/categoría o `status=hidden` en página. Conserva el documento publicado, IDs, campos, imágenes y referencias. No es el unpublish destructivo que elimina el ID publicado de Sanity. La web lo excluye después de su reconstrucción existente.
- **Volver a publicar:** recupera la visibilidad y, si hay draft persistido, publica también ese draft con guardas de revisión, en una transacción. No pierde los cambios guardados. Se exige guardar los cambios locales antes.

Antes de retirar una publicación con draft pendiente hay que publicar o descartar ese draft. Así la retirada no reescribe ni pierde silenciosamente trabajo de otro editor.

## Estados

Los cuatro estados de documentos guardados son Publicado, Borrador, Cambios pendientes de publicar y Retirado de publicación. Retirado describe el estado de la versión publicada y puede coexistir con un draft pendiente; el editor lo indica por separado. Un documento nuevo sin persistir se identifica como Nuevo · sin guardar. Cambios locales sin guardar es una advertencia independiente.

Estos estados describen Sanity, no el resultado de GitHub Pages. El seguimiento del despliegue corresponde a la iteración 4. Una publicación de plato puede seguir sin aparecer si su categoría está retirada: la retirada de categoría oculta su colección completa, sin modificar los estados individuales de sus platos.

## Reglas backend y referencias

- Todas las acciones vuelven a autenticar y autorizar el restaurante mediante la capa existente de Supabase/RLS, rol, módulo e integración. La excepción de production de Salitre permanece intacta. No hay IDs de Salitre en los componentes/editor.
- `discard`, `withdraw` y `restore` reciben ambas revisiones esperadas. Conflictos devuelven 409 y no se reintentan. El descarte guarda la revisión del draft en una transacción antes de eliminar exclusivamente ese draft; no toca la revisión publicada ni dispara una reconstrucción de contenido publicado por sí mismo.
- No se permite retirar settings, story, gallery o la portada inicio. Las cuatro páginas lógicas deben conservar sus slugs, también al recuperar un draft antiguo; carta/restaurante/reservas pueden ocultarse manteniendo su documento.
- Ocultar una categoría conserva los platos y sus referencias. Ocultar un plato no modifica su categoría ni sus assets. Recuperar la categoría devuelve a la web los platos que siguen visibles; no activa los ocultos individualmente.
- Los bloques de carta ya filtran visibilidad en Astro. Los IDs referenciados siguen existiendo y sus relaciones no se invalidan.
- Antes de retirar una página, se comprueban enlaces explícitos en bloques, Portable Text, composición y configuración publicados. Hay un límite seguro de 1000 fuentes; no se trunca una comprobación. Si existe dependencia, se requiere actualizar los enlaces primero. Para proteger enlaces absolutos que incluyan la base de GitHub Pages, también se tratan conservadoramente como dependencias los href HTTPS cuyo último segmento coincide con esa ruta, aunque el destino sea externo.
- La publicación/recuperación también rechaza enlaces explícitos a páginas retiradas. Los CTA históricos implícitos ya se ocultan cuando falta una ruta pública. No se reescribe contenido de otras páginas automáticamente.
- Se preservan campos desconocidos y los contratos de la iteración 1. No hay borrado definitivo de publicaciones ni limpieza de imágenes globales.

## Navegación

El router de datos nativo de React Router permite `useBlocker` para enlaces, navegación programática y atrás/adelante. No se manipula history manualmente. El selector de restaurante y cerrar sesión comprueban la misma guarda **antes** de cambiar contexto. Cancelar mantiene restaurante, formulario y cambios.

Guardar correctamente limpia la advertencia; volver a los valores originales también. `beforeunload` protege recarga/cierre dentro de las restricciones del navegador (mensaje nativo y posible requisito de interacción previa). Las operaciones en curso y uploads mantienen una guarda hasta terminar, para no llevar su resultado a otro restaurante. Los editores se desmontan por documento y restaurante; las respuestas tardías no actualizan otro editor.

## Pruebas sin tocar datos reales

`npm test` incluye transacciones de ensayo para descarte, retirada/recuperación, revisiones, referencias, documentos estructurales y autorización, además de guardas y estados en React. Playwright intercepta toda la API Supabase y prueba edición, descarte persistido/nuevo, retirada, recuperación y navegación entre restaurantes. Nunca elimina, retira o modifica documentos reales durante CI.

`npm run lint`, `npm run format:check`, `npm run typecheck`, `npx tsc -p tsconfig.edge.json`, `npm run build` y CI Deno comprueban tipos y compilación. La prueba de empaquetado localhost incluye `shared/editorial-state.ts` para ambas funciones. No necesita cambios de schemas Studio ni de Astro: los campos de visibilidad/status ya existen y se consumen en sus main actuales.

## Validación funcional desde el dashboard

1. Editar un plato y guardar. Debe indicar Cambios pendientes de publicar; Descartar cambios recupera la versión publicada sin cambiar la web.
2. En un plato sin draft, Retirar de publicación. Tras reconstruirse la web desaparece, pero sigue listado como Retirado. Volver a publicar lo recupera. Para una categoría, tener en cuenta que afecta a la visibilidad de todos sus platos.
3. Cambiar un texto sin guardar e intentar cambiar de sección o restaurante. Cancelar conserva el editor y la selección; guardar permite navegar sin una advertencia falsa.

No hay configuración manual nueva en Supabase, Sanity o GitHub. El frontend se publica por la integración Vercel existente al integrar main y las funciones mediante el workflow manual autorizado. No ejecutar bootstrap ni herramientas de staging.
