# Iteración 1 — Contrato editorial Dashboard → Sanity → Astro

## Alcance y fuentes verificadas

Se han obtenido las referencias reales de main el 31 de octubre de 2026 mediante git fetch, antes de crear worktrees independientes:

| Repositorio                   | Main de partida |
| ----------------------------- | --------------- |
| restaurant-platform-dashboard | 118c62d         |
| restaurant-premium-sanity     | adc9401         |
| studio-salitre-restaurant     | 304c823         |

La copia antigua de Astro usada en la auditoría anterior no representaba main. Main ya incluye páginas dinámicas, diez bloques, navegación y visibilidad. No se recrean esas funcionalidades.

Esta iteración solo cambia contratos, presentación de campos y lectura/renderizado. No consulta datasets, aplica SQL, publica documentos, despliega servicios ni habilita production. La barrera backend de staging permanece intacta. Los tests usan fixtures sintéticas, no exports de Sanity.

## Inventario completo

D = contenido dinámico existente; E = fijo editorial convertido en override opcional; V = configuración/composición visual; S = texto/estado del sistema. «Compatible» se refiere al código y pruebas offline, no a una edición remota realizada.

Los paths son relativos a `src/components/` en Astro. Formularios: Páginas, Configuración editorial, Categorías, Platos, Historia y chef, Galería. FormFields renderiza los campos tipados; no hay editor JSON. El contrato Sanity almacenado usa referencias a assets/categorías/platos. GROQ transforma imágenes a URL/alt y referencias de bloques a categoryIds/dishIds para la presentación; no son dos modelos de almacenamiento.

### Cabecera, navegación y estructura

| Elemento / clase                                               | Astro                          | Documento y campo Sanity                                    | Dashboard                                             | Estado / cambio                                                                                 |
| -------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nombre y enlace de marca — D                                   | Header, BaseLayout             | settings.name; ruta pública resuelta desde page.slug/status | Configuración → Nombre; Páginas → Ruta/Visibilidad    | Compatible; no tenant fijo en formularios                                                       |
| Logotipo y alt — D                                             | Header                         | settings.logo.asset/alt                                     | Configuración → Logo                                  | Compatible; upload autenticado y referencia validada                                            |
| Firma bajo marca — E                                           | Header                         | settings.editorial.signature                                | Configuración → Cabecera, pie, carta y franja → Firma | Nuevo opcional; antes «COCINA DE ORIGEN» fijo                                                   |
| Rutas y páginas nuevas — D                                     | pages/[...slug], lib/pages     | page.slug.current                                           | Páginas → Ruta                                        | Ya dinámico; no se duplica                                                                      |
| Etiqueta, orden, presencia en menú — D                         | Header, lib/pages              | page.navigationLabel/navigationOrder/showInNavigation       | Páginas → Navegación                                  | Compatible; enlaces bajo BASE_URL                                                               |
| Visibilidad y bloques — D                                      | pages/[...slug], BlockRenderer | page.status/blocks                                          | Páginas → Visibilidad/Bloques                         | Ocultos no generan ruta; bloques no vacíos conservan el comportamiento de sustitución existente |
| Orden de secciones históricas, anchos, numeración de fotos — V | HomePage/StoryPage y CSS       | Composición histórica del renderer; no nuevo campo          | No editable aquí                                      | Se conserva el diseño; no es el template futuro                                                 |

### Páginas y composiciones históricas

Todos los campos nuevos siguientes pertenecen a `page.composition`; no cambian `page.blocks`. El formulario muestra solo los grupos usados por cada ruta histórica, y no los ofrece para páginas con bloques. Los datos existentes siguen preservándose al guardar.

| Elemento / clase                                                  | Astro                                           | Campo Sanity                                                                         | Dashboard                             | Estado / cambio                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------- |
| Antetítulo, h1, introducción de cada página — D                   | PageIntro/HomePage                              | page.eyebrow/title/intro                                                             | Páginas → Contenido                   | Compatible; optional/null de textos introductorios admitidos en backend          |
| Imagen principal y alt — D                                        | HomePage/PageIntro/StoryPage/ContactPage, Photo | page.image.asset/alt                                                                 | Páginas → Imagen                      | Compatible; layout y optimización existentes                                     |
| Pie de foto del hero — E                                          | HomePage                                        | composition.hero.caption                                                             | Páginas inicio → Hero original        | Nuevo override                                                                   |
| Coordenadas y texto lateral — E                                   | HomePage                                        | composition.hero.coordinates/sideNote                                                | Inicio → Hero original                | Nuevos overrides; saltos de línea sin HTML                                       |
| Enlace del hero — E                                               | HomePage, EditorialLink                         | composition.hero.link.label/href                                                     | Inicio → Hero original → Enlace       | Personalizable/ocultable; default carta                                          |
| Antetítulo y titular de concepto — E                              | HomePage, EditorialHeading                      | composition.essence.eyebrow/heading                                                  | Inicio → Concepto                     | Nuevo; conserva salto de línea y cursiva originales                              |
| Texto del concepto — D                                            | HomePage                                        | settings.concept                                                                     | Configuración → Concepto              | Ya editable; sin copia adicional                                                 |
| Enlace del concepto — E                                           | HomePage                                        | composition.essence.link                                                             | Inicio → Concepto → Enlace            | Nuevo override                                                                   |
| Antetítulo/titular de destacados — E                              | HomePage                                        | composition.featured.eyebrow/heading                                                 | Inicio → Platos destacados            | Nuevo; tres posiciones y diseño conservados                                      |
| Selección, nombre, precio, descripción e imagen de destacados — D | HomePage                                        | dish.featured/available/visible/order/name/price/description/image; category.visible | Platos; Categorías                    | Se reutilizan los documentos de carta                                            |
| Enlace y estado vacío de destacados — E                           | HomePage                                        | composition.featured.link/empty                                                      | Inicio → Platos destacados            | Nuevos overrides                                                                 |
| Antetítulo y enlace de avance de historia — E                     | HomePage                                        | composition.storyPreview.eyebrow/link                                                | Inicio → Avance de historia           | Nuevos overrides                                                                 |
| Título, historia e imagen del avance — D                          | HomePage                                        | story.title/body/image                                                               | Historia y chef                       | Se reutiliza el singleton                                                        |
| Antetítulo de historia y chef — E                                 | StoryPage                                       | composition.story.eyebrow; composition.chef.eyebrow                                  | Restaurante → Historia/Chef           | Nuevos overrides                                                                 |
| Historia, filosofía y chef — D                                    | StoryPage                                       | story.title/body/philosophy/chefName/chefBio/image                                   | Historia y chef                       | Compatible; ID restaurant-story conservado                                       |
| Antetítulo, titular y vacío de galería — E                        | StoryPage                                       | composition.gallery.eyebrow/heading/empty                                            | Restaurante → Galería                 | Nuevos overrides                                                                 |
| Fotos, alt y orden de galería — D                                 | StoryPage, Photo                                | gallery.images[]                                                                     | Galería → Fotografías                 | Compatible; pie visible derivado de ordinal y alt, ambos sin documento duplicado |
| Antetítulo/titular de contacto — E                                | ContactPage                                     | composition.contact.eyebrow/heading                                                  | Reservas → Contacto                   | Nuevos overrides                                                                 |
| Texto del botón de proveedor — E                                  | ContactPage                                     | composition.contact.providerLabel                                                    | Reservas → Contacto                   | Texto editable; no altera condiciones de activación                              |
| Proveedor real de reservas — D                                    | ContactPage                                     | settings.reservationUrl/isFictional                                                  | Configuración → Reservas/Demostración | Solo HTTPS; demo/ficticio no tramita reservas                                    |
| Mensaje sin proveedor — E                                         | ContactPage                                     | composition.contact.unavailable                                                      | Reservas → Contacto                   | Nuevo override; no añade formulario ni confirma reservas                         |
| Títulos de horario y dirección — E                                | ContactPage                                     | composition.contact.hoursTitle/addressTitle                                          | Reservas → Contacto                   | Nuevos overrides                                                                 |
| Dirección, email y teléfono — D                                   | ContactPage/Footer/JSON-LD                      | settings.address/email/phone                                                         | Configuración → Contacto              | Compatible; enlaces reales siguen condicionados por isFictional                  |
| Horarios y orden — D                                              | ContactPage                                     | settings.hours[].days/time/_key                                                      | Configuración → Horarios              | Array existente; claves preservadas                                              |

`heading` es un objeto `editorialHeading` con before/emphasis/after. Texto escapado, sin HTML arbitrario. Un titular personalizado es atómico: omitir emphasis no incorpora la cursiva antigua. El objeto debe contener texto; no se publican titulares vacíos desde el editor.

### Carta

| Elemento / clase                                    | Astro                                     | Campo Sanity                                    | Dashboard                          | Estado / cambio                                                         |
| --------------------------------------------------- | ----------------------------------------- | ----------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Categorías, nota, orden, visibilidad — D            | MenuPage/MenuSection/MenuBlock, lib/pages | category.name/note/order/visible                | Categorías                         | Compatible; nota opcional/null admitida                                 |
| Plato, descripción y precio — D                     | MenuSection/HomePage                      | dish.name/description/price                     | Platos                             | EUR/IVA, dos decimales validados en editor; formato monetario calculado |
| Relación plato-categoría — D                        | lib/pages/MenuSection                     | dish.category._ref                              | Platos → Categoría publicada       | Referencias de tipo correcto y publicadas verificadas por backend       |
| Alérgenos — D                                       | MenuSection                               | dish.allergens[]                                | Platos → Alérgenos                 | Sin enumeración nueva incompatible                                      |
| Disponibilidad, destacados, visibilidad y orden — D | lib/pages/HomePage/MenuSection            | dish.available/featured/visible/order           | Platos                             | Categoría oculta también oculta sus platos; agotados siguen visibles    |
| Imagen y alt de plato — D                           | HomePage/Photo                            | dish.image.asset/alt                            | Platos → Imagen                    | Compatible; la carta textual conserva su diseño sin foto por fila       |
| Etiquetas — D                                       | Contrato de plato                         | dish.tags[]                                     | Platos → Etiquetas                 | Conservadas; no se inventa una presentación nueva                       |
| Mensajes de categoría/carta vacía — E               | MenuSection (también bloques)             | settings.editorial.menu.emptyCategory/emptyMenu | Configuración → Textos de la carta | Nuevos overrides globales                                               |
| Aviso de precios/alérgenos — E                      | MenuSection                               | settings.editorial.menu.disclaimer              | Configuración → Textos de la carta | Nuevo; contenido editorial que debe revisar el operador                 |
| Sin alérgenos y no disponible — E                   | MenuSection                               | settings.editorial.menu.noAllergens/unavailable | Configuración → Textos de la carta | Nuevos overrides; el estado sigue calculándose con datos reales         |

### Footer, CTA y SEO

| Elemento / clase                                                                   | Astro                                   | Campo Sanity                                        | Dashboard                                          | Estado / cambio                                                        |
| ---------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| Nombre, tagline y dirección — D                                                    | Footer                                  | settings.name/tagline/address                       | Configuración                                      | Ya editable                                                            |
| Segunda firma del footer — E                                                       | Footer                                  | settings.editorial.footer.line                      | Configuración → Pie de página                      | Antes fija; nuevo override                                             |
| Enlace del footer — E                                                              | Footer, EditorialLink                   | settings.editorial.footer.link                      | Configuración → Pie de página                      | Etiqueta/destino editables; null oculta                                |
| Volver arriba — E                                                                  | Footer                                  | settings.editorial.footer.backToTop                 | Configuración → Pie de página                      | Texto editable; #top técnico permanece fijo                            |
| Franja CTA — E                                                                     | ReservationCTA                          | settings.editorial.reservation.eyebrow/heading/link | Configuración → Franja de reservas                 | Sin cambiar sección/clases/composición; enlace oculto retira la franja |
| Título y descripción SEO — D                                                       | BaseLayout                              | page.seo.title/description                          | Páginas → SEO                                      | HTML estático, OG y Twitter coherentes                                 |
| Imagen social por página — D                                                       | BaseLayout                              | page.seo.image                                      | Páginas → SEO → Imagen para compartir              | Prioridad máxima                                                       |
| Imagen social general — E                                                          | BaseLayout                              | settings.socialImage                                | Configuración → Imagen social predeterminada       | Nueva; fallback final al JPEG local existente                          |
| Noindex — D/S                                                                      | BaseLayout, sitemap                     | page.noindex; settings.isFictional; origen demo     | Páginas/Configuración                              | La demo no puede desactivar sus protecciones mediante estos textos     |
| Canonical, base, sitemap, robots y datos estructurados — S                         | BaseLayout, pages/                      | Configuración de build y campos anteriores          | Sin campo de URLs técnicas                         | No se confían hosts/base arbitrarios al CMS                            |
| Colores, fuente, botones, estilo — V                                               | BaseLayout/CSS                          | settings.theme.*                                    | Configuración → Identidad visual                   | Modelo existente; null hereda el tema inicial                          |
| Avisos de restaurante ficticio, bios ficticias y demo — S                          | ContactPage/StoryPage/Footer/BaseLayout | Condición settings.isFictional / source             | Selector de demostración, no texto libre del aviso | Protecciones conservadas                                               |
| 404, accesibilidad, errores/carga, prefijo «Alérgenos», unidades y ordinales — S/V | 404, componentes y helpers              | Estados técnicos/formato                            | No editor comercial para mensajes del sistema      | Fijos deliberadamente, inventariados; no contenido comercial oculto    |

### Bloques existentes (sin conversión automática)

| Bloque / Astro                                | Campos Sanity dentro de page.blocks[]            | Formulario               | Estado                                                                                      |
| --------------------------------------------- | ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------- |
| hero / HeroBlock                              | title/subtitle/image/cta                         | Páginas → Bloques → Hero | Compatible                                                                                  |
| richText / TextBlock, RichText, RichParagraph | title/body/width, Portable Text y marcas/enlaces | Texto enriquecido        | Compatible; render conserva el tratamiento existente de listas                              |
| imageText / ImageTextBlock                    | title/image/body/position/cta                    | Imagen y texto           | Compatible                                                                                  |
| galleryBlock / GalleryBlock                   | title/images[]                                   | Galería                  | Compatible                                                                                  |
| menuSection / MenuBlock                       | title/categories[]/dishes[]                      | Carta                    | Referencias almacenadas, IDs adaptados en GROQ; textos globales nuevos aplican también aquí |
| cards / CardsBlock                            | title/items[].title/description/image/link       | Tarjetas                 | Compatible                                                                                  |
| cta / CTABlock                                | title/description/image/cta                      | CTA                      | Compatible                                                                                  |
| faq / FAQBlock                                | title/items[].question/answer                    | FAQ                      | Compatible                                                                                  |
| divider / DividerBlock                        | spacing/line                                     | Separador                | Compatible                                                                                  |
| notice / NoticeBlock                          | title/text/cta/startsAt/endsAt                   | Aviso                    | Compatible; fechas evaluadas en build, sin nueva automatización                             |

Todos conservan _type/_key, variant/alignment donde corresponda. No se cambian IDs singleton ni referencias. Quitar una imagen no borra el asset global. Crop/hotspot existentes se preservan en el backend; esta iteración conserva el recorte CSS del diseño y no añade un editor visual de imágenes.

## Semántica y compatibilidad hacia atrás

- Campos aditivos opcionales: page.composition, settings.editorial, settings.socialImage. No documentos nuevos.
- No se rellena ningún documento al leer. Los textos históricos de Astro son defaults del adaptador de presentación, separados del fallback de dataset demo. Un CMS configurado sigue siendo la fuente de sus datos.
- Ausente/null en textos/grupos: conserva default. Link ausente: conserva default; link null: oculta ese enlace. Restaurar en dashboard elimina el override. Un enlace interno a una página oculta no se muestra.
- Las opciones nuevas son del adaptador de composición original, no una enumeración de restaurantes. Ningún componente genérico recibe IDs de Salitre/proyecto/dataset.
- La imagen social resuelve page.seo.image → settings.socialImage → og-default.jpg. El dato de página conserva prioridad.
- Las páginas con bloques usan sus bloques. Los overrides históricos se conservan pero no alteran la selección de renderer.
- El esquema fuente sigue en Studio. Los contratos de almacenamiento del backend y presentación Astro se comprueban con la misma fixture sintética `tests/fixtures/editorial-contract.json` en los tres repositorios.
- No se requiere migración de datos. No ejecutar export/import, bootstrap ni backfills para esta iteración.

## Incompatibilidades corregidas

1. Textos y enlaces comerciales históricos carecían de campos/formularios: ahora tienen overrides opcionales sin sustituir composiciones.
2. La imagen social general solo podía cambiarse como archivo del repositorio: ahora admite asset editable global, manteniendo override por página.
3. Algunos opcionales raw podían ser null en Sanity y eran rechazados por el backend (nota, navegación, introducción/antetítulo y theme): se admiten sin relajar campos obligatorios.
4. Importar schemaTypes/index.ts desde Node para validar offline fallaba por imports relativos sin extensión: Studio usa extensiones .ts explícitas y comprobación TypeScript compatible.

## Pruebas y validación sin servicios remotos

Dashboard: npm run lint, npm run format:check, npm run typecheck, npx tsc -p tsconfig.edge.json, npm test, npm run build y npm run test:e2e con endpoints interceptados. check:edge requiere Deno disponible; nunca desplegar para validarlo.

Astro: ASTRO_TELEMETRY_DISABLED=1 SANITY_USE_MOCK=true npm run check; npm test; build con SANITY_USE_MOCK=true; npm run check:build. **No ejecutar check:cms** en esta revisión sin autorizar su lectura remota. Pruebas estáticas deben comprobar defaults y overrides escapados, rutas, enlaces y SEO; las fotos no se descargan para compilar.

Studio: npm run check, npm test y build local. Validación oficial de fixtures en memoria con cliente sin red. El test exige validación limpia, sin descartar avisos del validador oficial. No ejecutar deploy, schema:deploy, seed ni herramientas ops.

La fixture común debe tener la misma huella SHA-256 en los tres repositorios. Estas pruebas no acreditan publicación real desde Edge ni configuración efectiva de los servicios.

## Orden de integración y siguiente iteración

PRs separadas: frontend Astro compatible → Studio/schema → dashboard. Revisar resultados antes de integrar. El push a main de Astro dispara su workflow de Pages existente: integrar/desplegar requiere la decisión del operador. No se ha hecho merge ni ejecutado workflows manuales. Publicar schemas/Studio también es una operación remota independiente que no se ejecuta aquí.

Iteración 2: verificar mediante lectura autorizada los UUID reales de restaurante/integración y su configuración; diseñar la excepción backend exacta Salitre + integración + hfa8zkyw + production, conservar staging por defecto y pruebas de denegación para los demás. Cambiar la fila existente conservando su UUID y SANITY_TOKENS solo tras autorización. Sin clonar datasets ni repetir bootstrap. Activación production, eliminación editorial y seguimiento de despliegue no forman parte de esta iteración.
