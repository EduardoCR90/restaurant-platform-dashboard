# Fase 6 · Iteración 2 — aprovisionamiento de webs Astro

## Flujo preparado

`astro-provisioning` continúa un trabajo de Sanity completado y crea una web independiente sin aceptar identificadores de proveedor desde el navegador. La [iteración 3](restaurant-provisioning.md) lo coordina desde el alta integral:

1. exige un Super Admin activo en Auth, Edge y SQL;
2. resuelve el restaurante, integración Sanity y release aprobada desde Supabase;
3. deriva un repositorio estable `<slug>-restaurant`, URL provisional `https://<owner>.github.io/<repo>/` y base `/<repo>`;
4. verifica que el HEAD del repositorio template coincide con el commit inmutable del catálogo;
5. genera un repositorio desde el GitHub template y despacha su bootstrap con una especificación pública y su SHA-256;
6. el bootstrap materializa una instancia mínima, incorpora la distribución versionada, ejecuta verify/check/tests/build y publica el commit;
7. el workflow informa mediante OIDC. Edge verifica issuer, audiencia, main, ruta del workflow, repository ID, commit y hash del manifest consultado de nuevo en GitHub;
8. habilita Pages con `build_type=workflow` y registra `website_deployments`, versión deseada, módulos y dominio todavía no verificado;
9. el workflow oficial de Pages informa build y despliegue mediante el seguimiento OIDC existente. Solo sus evidencias `ready` y `succeeded` registran la versión instalada.

El restaurante permanece `pending` al terminar esta función; el aprovisionador integral asigna el cliente y lo activa después de verificar el resto del recorrido. Esta función no crea ningún recurso por sí sola hasta recibir una solicitud autorizada; las pruebas sustituyen GitHub y usan PostgreSQL local.

## Idempotencia y recuperación

`request_id` y el hash del contrato fijan una única solicitud. La base conserva las etapas `queued`, `repository_created`, `initialization_dispatched`, `source_ready` y `completed`. Un lease de cinco minutos protege operaciones activas. No hay reintentos automáticos: un fallo recuperable requiere `retry` explícito.

Antes de generar se consulta el nombre determinista. Un repositorio preexistente solo se reutiliza si GitHub confirma owner, visibilidad, rama y `template_repository.id` exactos. Una respuesta ambigua o un manifest distinto pasa a `manual_review`; nunca se elimina, reinicializa o sobrescribe un repositorio. Repetir el bootstrap exige el mismo request y specification hash. Pages se habilita después de verificar el código publicado.

La única evidencia alternativa aceptada para la procedencia es una respuesta `201` recibida directamente del endpoint autenticado de generación de la plantilla. Esa respuesta demuestra qué template se solicitó aunque GitHub todavía no haya materializado `template_repository` en el objeto devuelto. Si el repositorio ya existía o se recupera después de una escritura ambigua, la relación exacta con el ID de la plantilla sigue siendo obligatoria. Un ID distinto siempre se rechaza.

El defecto anterior validaba inmediatamente el objeto de la respuesta de generación como si fuera una lectura estable y exigía su campo opcional `template_repository.id`. GitHub ya había creado el repositorio, pero una respuesta todavía incompleta terminaba en `repository_conflict` antes de guardar el checkpoint. La corrección distingue la evidencia directa de creación de la adopción posterior; no relaja ninguna comprobación para repositorios preexistentes.

La validación registra únicamente categorías cerradas (`repository_name`, `repository_owner`, `default_branch`, `visibility`, `template_provenance`), origen de la evidencia y resultado. No registra nombres, IDs, respuestas del proveedor ni credenciales. Las respuestas estructuralmente incompletas se tratan como ambiguas y no se adoptan. El caso controlado de Abre Tu Corazón está documentado en [`ops/abre-tu-corazon-recovery`](../ops/abre-tu-corazon-recovery/README.md); su SQL no se ejecuta en CI ni reintenta el aprovisionamiento.

La limitación de GitHub para `generate repository from template` es que usa el default branch. Por ello una instancia nueva solo se crea si `main` del template coincide exactamente con el release aprobado. Las actualizaciones posteriores conservan el actualizador de fase 5: integridad por archivo, compatibilidad SemVer, build aislada, PR/CI y confirmación OIDC. La configuración, contenido y assets de la instancia quedan fuera de los archivos generados por el package compartido.

## Permisos y secretos

Configura en **Supabase → Edge Functions → Secrets**:

- `GITHUB_PROVISIONER_TOKEN`: credencial backend dedicada con acceso al template y permisos mínimos para generar/administrar repositorios, despachar Actions y configurar Pages. No se entrega al workflow ni al navegador.
- `GITHUB_REPOSITORY_OWNER`: propietario de las instancias.
- `GITHUB_TEMPLATE_REPOSITORY`: por ejemplo `EduardoCR90/restaurant-astro-template`.
- `GITHUB_TEMPLATE_REPOSITORY_ID`: ID numérico inmutable del repositorio template.
- `GITHUB_INSTANCE_BOOTSTRAP_WORKFLOW=bootstrap-instance.yml`.
- `GITHUB_INSTANCE_VISIBILITY=private` o `public` según el plan de GitHub Pages.

Marca `restaurant-astro-template` como **Template repository** en GitHub. Para una cuenta personal, una credencial de servicio puede ser necesaria para crear repositorios; en una organización es preferible una GitHub App con permisos limitados. La disponibilidad de Pages para repositorios privados depende del plan de GitHub. Ninguna credencial se guarda en GitHub, Vercel, la instancia o PostgreSQL.

La instancia contiene únicamente datos públicos: proyecto/dataset Sanity, tema, módulos, URL y release. El token editorial cifrado permanece en Supabase Edge. El dataset público permite la build sin token; si más adelante se hace privado, el token de solo lectura deberá configurarse como secret del repositorio mediante un flujo backend separado.

## Dominio y despliegue

La primera publicación siempre usa la URL provisional de Pages. Un dominio solicitado se almacena con estado `unverified`; no se crea CNAME, DNS ni certificado. La iteración 3 podrá verificar propiedad antes de configurar `cname` y cambiar el origen. El workflow generado usa `withastro/action`, `actions/configure-pages` y `actions/deploy-pages`, base correcta y concurrencia por repositorio.

El bootstrap necesita `contents:write`, `actions:write` e `id-token:write` únicamente durante la inicialización. Los workflows finales usan permisos por job. Los callbacks no usan secretos compartidos: GitHub emite tokens OIDC efímeros con audiencias distintas para bootstrap y publicaciones.

## Validación sin recursos reales

- Contratos estrictos rechazan tokens, project IDs, repositorios y comandos aportados por el cliente.
- Tests de servicio cubren repositorio único, hash exacto, fallo ambiguo, manifest, Pages y ausencia de reintento.
- PGlite ejecuta la migración real y prueba Super Admin, clientes, aislamiento, recuperación, módulos, versión deseada y ausencia de versión instalada antes del despliegue firmado.
- El template materializa, instala y compila una instancia sintética de cuatro páginas con base de GitHub Pages.
- El empaquetado de Supabase CLI se valida contra localhost; no contacta con Supabase ni GitHub reales.

Antes de la primera creación controlada, configura los secretos, mantén habilitado el modo template, verifica el plan de Pages y usa el panel integral para reunir en una sola solicitud el alta de Sanity, la selección visual/módulos y esta etapa Astro.
