# Iteración 4 — Publicación y actualización de la web

## Flujo conservado

Sanity sigue enviando el webhook existente a `workflow_dispatch` de `restaurant-premium-sanity/.github/workflows/deploy.yml`. Los push a main y las ejecuciones manuales siguen usando ese mismo workflow, la acción oficial de Astro y GitHub Pages. El dashboard no hace dispatch ni introduce otro disparador. Guardar, descartar o subir una imagen no solicita despliegues desde el dashboard; el filtro del webhook debe seguir excluyendo drafts y versiones.

El propietario validó el flujo editorial real al finalizar las iteraciones 2 y 3. Esta implementación añade observabilidad sin repetir migraciones de contenido ni cambiar los modelos del Studio.

## Registro y correlación

`publication_operations` guarda restaurante, integración, actor autenticado, documento, acción, UUID de operación, fechas y estado. No duplica contenido editorial. Solo publish, withdraw y restore pasan por este registro, después de la autorización editorial existente y de validar revisiones/referencias. Un UUID repetido no vuelve a escribir en Sanity. La revisión confirmada procede de la respuesta de la mutación, nunca de una lectura posterior que podría incluir cambios de otro editor.

`website_deployments` configura en servidor el restaurante, integración, proyecto/dataset, repositorio (nombre e ID inmutable) y URL. No lo acepta el cliente ni se modifica desde el formulario. Cada restaurante tiene su propio destino.

Astro añade `_id/_rev` a la misma consulta GROQ que genera el HTML. Antes de validar el contenido calcula SHA-256 sobre `JSON.stringify([projectId,dataset,documentId,revision])`. Solo esas huellas, el run ID, intento y SHA se conservan en el artefacto temporal `publication-evidence` (2 días); no contiene documentos, tokens, nombres, textos ni imágenes. No se sirve en la web ni se incluye en Git.

El workflow informa inicio, resultado de build y resultado de Pages. El último informe usa exactamente la evidencia del job build de la misma ejecución/intento/SHA. Solo confirma éxito después de que Pages y sus verificaciones públicas hayan terminado correctamente. La función `publications` verifica criptográficamente el OIDC de GitHub (RS256/JWKS, issuer, audience, vigencia, ref main, ruta exacta del workflow, nombre e ID del repositorio registrado). El run ID y el intento proceden del JWT firmado, no del cuerpo. No necesita PAT GitHub adicional ni secretos de callback.

No se consulta ni se asume que el último workflow corresponde a la publicación. La reconciliación exige coincidencia de huellas. Varias operaciones pueden estar cubiertas por el mismo run. Si dos cambios sucesivos del mismo documento se incluyen como una única revisión final, se sigue la cadena exacta de revisiones anteriores/siguientes registradas. No se sustituye esa prueba por una comparación de fechas. Cambios externos de Studio que rompan la cadena pueden dejar una operación anterior sin confirmar: se informa explícitamente, sin inventar éxito.

## Estados y fallos

- Publicando en Sanity: registro previo a la mutación y señal inmediata en UI.
- Publicado en Sanity, pendiente de despliegue: revisión aceptada y registrada.
- Despliegue en curso: esa revisión, o su sucesora verificada, pertenece a la instantánea de una build.
- Web actualizada: el run que contiene esa instantánea informa éxito del job Pages y sus comprobaciones.
- Error al publicar en Sanity: rechazo o resultado no confirmado; hay que recargar antes de repetir.
- Error al desplegar la web: fallo correlacionado, destino sin configurar o falta de confirmación tras 30 minutos.

La pérdida de confirmación de Sanity expira a los 2 minutos. Los estados se reconcilian al consultar (cada 8 segundos mientras se muestra el panel) y al recibir informes; no requieren cron. Una evidencia válida posterior recupera una operación que antes había expirado. Un error de OIDC, JWKS o comunicación no reintenta escrituras ni despliegues y no confirma la web. El workflow conserva el despliegue aunque falle solo el informe; deja una advertencia segura y el dashboard explica la falta de confirmación. Cancelaciones completas o builds que fallan antes de leer Sanity pueden no aportar evidencia; expiran como no confirmadas.

El panel aparece en el resumen, los listados y el documento. El despliegue no bloquea la edición. Las operaciones anteriores a esta iteración no se inventan ni se importan al historial.

## Duplicados y reejecución

Los informes son idempotentes por destino/run/intento y no degradan un resultado terminal. La evidencia de un intento no se puede cambiar. Las transacciones se serializan por destino. El grupo de concurrencia Pages existente sigue evitando despliegues simultáneos.

Tras la build, si las huellas y el SHA coinciden con el último despliegue confirmado, se omite el job Pages. Se conserva como prueba el run que realmente desplegó, sin atribuir éxito de despliegue al run omitido. No se omite una restauración a revisiones antiguas cuando entre medias se desplegaron otras.

No hay reintentos automáticos. Ante un fallo corregido, ejecutar el workflow completo en main; no reejecutar solo el job Pages con un artefacto de otro intento. Publicar de nuevo en Sanity no es un mecanismo de reintento del despliegue.

## Instalación y permisos

Orden de integración:

1. Integrar la PR del dashboard con CI aprobada.
2. Ejecutar **Configure publication tracking (manual)** desde main: `operation=inspect`, después `apply`. Usa el secreto existente `SUPABASE_ACCESS_TOKEN` y la API de gestión oficial de Supabase. Aplica únicamente `202610310002_publications.sql` si las tres tablas no existen y registra Salitre resolviendo su integración existente. Un esquema parcial o una configuración incompatible detiene el proceso; no sobrescribe filas. No cambia contenidos ni permisos editoriales existentes.
3. Ejecutar **Deploy Supabase Edge Functions**. Despliega content, platform-admin y publications; no ejecuta SQL ni bootstrap. Las peticiones de usuario siguen verificándose con Auth y authorize_content. El cliente privilegiado solo escribe estos metadatos después de esa autorización, o después de verificar OIDC para informes.
4. Integrar la PR Astro. Vercel publica el dashboard mediante su integración existente. Astro conserva su workflow, permisos Pages y webhook. Sus jobs de seguimiento añaden `id-token: write`; el job final solo necesita además lectura de artefactos.

La migración es aditiva: tablas nuevas, índices, RLS y dos RPC solo service_role. Authenticated solo puede leer operaciones de restaurantes autorizados con módulo activo; no puede crearlas, modificarlas, enviar informes ni consultar la configuración de destinos. No se conceden permisos de producción a otro restaurante.

No se añaden secretos ni variables frontend. El endpoint del script Astro es una URL pública de infraestructura, no una credencial; al aprovisionar una web en otra plataforma se configura allí su endpoint y se registra su repositorio en servidor. El token privado que ya utiliza el webhook Sanity permanece en Sanity, sin cambios.

## Pruebas y validación funcional

Las pruebas automáticas usan PostgreSQL PGlite, RSA de ensayo y APIs interceptadas. Cubren publicación, errores Sanity, correlación exacta, varios documentos, revisiones sucesivas, duplicados, fallo/expiración/recuperación, RLS, firmas falsas, otros repositorios/refs, comunicación con GitHub y estados UI. Las pruebas Astro comprueban evidencia, identidad de intento, no exposición de contenido y conservación del HTML/diseño.

Desde Salitre: editar un texto de prueba y **Publicar cambios**. Debe pasar de aceptación en Sanity a despliegue y finalmente **Web actualizada**; abrir la web y comprobar el texto. Mientras despliega se puede editar otro documento. No hace falta entrar en GitHub para conocer el resultado. No borrar ni retirar contenido real como prueba automatizada.
