# Contrato editorial e integración con Sanity

Fuente inspeccionada: EduardoCR90/studio-salitre-restaurant, main `f9cd750417306fbc6dd10de3fb29688856d2d915`, archivos schemaTypes/index.ts, blocks.ts y restaurant.ts. Frontend Astro de referencia: main `adc94019e989613895cdc7bb967f003ab23954cd`. No se ha modificado ninguno de esos repositorios o sus datos. La política actual conserva staging y añade únicamente la [excepción exacta de Salitre](salitre-production.md), cuando esté configurada y desplegada.

## Modelo reutilizado

| Documento | Campos editables                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| page      | title, slug.current, eyebrow, intro, image, status, showInNavigation, navigationLabel/order, SEO/noindex, blocks |
| category  | name, note, order, visible                                                                                       |
| dish      | name, description, price, category reference, allergens, image, available, visible, featured, order, tags        |
| settings  | Identidad, contacto, horarios, isFictional, reservationUrl, logo y theme                                         |
| story     | title, body, philosophy, chefName/Bio e image                                                                    |
| gallery   | images ordenadas                                                                                                 |

Los tres singleton IDs siguen siendo restaurant-settings, restaurant-story y restaurant-gallery. Sanity asigna el sufijo de los documentos ordinarios nuevos mediante el prefijo `drafts.` de su API de mutaciones. No se derivan IDs de slugs. Cada referencia usa un ID obtenido del dataset autorizado; categorías y platos referenciados deben estar publicados.

No se trasladan permisos comerciales a `settings.modules`: ese campo del Studio sigue siendo una preferencia visual, y se conserva aunque no se edite en este dashboard. También se preservan campos heredados que el formulario no gestiona. Las mutaciones solo pueden modificar los campos permitidos por el contrato. Los campos opcionales eliminados del formulario se quitan explícitamente del borrador, conservando los demás datos.

## Diez bloques

- hero: titular, subtítulo, imagen y CTA.
- richText: Portable Text con párrafos, h2/h3/cita, listas, fragmentos en negrita/cursiva y enlaces.
- imageText: imagen, texto, posición y CTA.
- galleryBlock: imágenes con alt, ordenables.
- menuSection: referencias a categorías y platos; vacío significa todos.
- cards: tarjetas editoriales con título, descripción, imagen y enlace.
- cta: titular, descripción, enlace obligatorio e imagen.
- faq: preguntas y respuestas ordenables.
- divider: espacio y línea.
- notice: texto, CTA y fechas opcionales, evaluadas en la build pública.

Todos conservan _type y _key, presentación y alineación donde aplica. Las arrays se reordenan sin regenerar claves. Los formularios no usan JSON libre para simular un editor. La validación compartida rechaza bloques desconocidos, rutas reservadas, enlaces inseguros, precios inválidos y claves de bloque duplicadas. La UI preserva marcas/enlaces de Portable Text; no convierte contenido existente a HTML ni lo aplana silenciosamente.

## Borradores y concurrencia

1. List/get muestran el estado real de borrador y publicación (hasta 1000 documentos raw por tipo en esta versión).
2. Create crea solo un borrador, con ID asignado por Sanity. No publica páginas vacías.
3. Save comprueba publishedRev y draftRev. Si ya hay borrador, patch exige ifRevisionID. Si no, create falla en colisión. Nunca createOrReplace.
4. Publish exige borrador guardado y sin cambios locales. Valida campos, slug y referencias; una transacción comprueba revisión del borrador y de la versión publicada, escribe la publicación y elimina únicamente su borrador.
5. Si otro editor cambia una revisión, devuelve 409. No se reintenta ni se sustituye automáticamente. Recarga, compara y decide. Si la publicación cambia durante un guardado, se avisa y no se autoriza publicarla con una revisión desactualizada.

No hay botones para borrar permanentemente páginas/platos/categorías publicados. Oculta con status/visible y publica el borrador. La portada existente no puede renombrarse ni ocultarse desde este adaptador. Una operación de publicación eliminando el borrador no equivale a borrar el contenido publicado.

## Imágenes

La UI sube bytes al backend autenticado. El servidor limita tamaño, valida MIME/firma, resuelve la integración y sube a Sanity Asset Pipeline. Devuelve referencia y URL; el token nunca sale del backend. Alt es obligatorio al guardar una imagen. Crop/hotspot de imágenes existentes se conservan. Quitar una imagen del documento no elimina el asset global. Un upload cancelado puede dejar un asset sin uso: no se hace limpieza destructiva automática.

## Web pública y flujo de reconstrucción

Publicar cambia Sanity, no el HTML ya generado. Se conserva el workflow de Astro/GitHub Pages existente. Si su webhook está activo, la publicación lo activará según su configuración; si no, ejecuta el workflow manual de la web pública. Este dashboard no crea, modifica o acredita un webhook, ni pide su token al navegador.

Salitre está autorizado como restaurante de pruebas; valida la configuración limitada y el despliegue descritos en salitre-production.md antes de probar publicaciones. Las pruebas locales mockean la API; ninguna escritura real se realizó para comprobar esta fase.

## Contrato editorial aditivo — iteración 1

La revisión coordinada parte de Studio main 304c823 y Astro main adc9401. Añade page.composition, settings.editorial y settings.socialImage sin cambiar los documentos existentes ni el contrato salitre-v1. [Inventario y semántica de herencia](editorial-compatibility.md). Los formularios no convierten páginas a bloques y los defaults no se guardan automáticamente en Sanity. La barrera de staging continúa vigente.
