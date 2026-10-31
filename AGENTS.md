# Restaurant Platform · Convenciones

- Leer README y docs/architecture.md, docs/security.md y docs/sanity.md antes de cambiar contratos.
- React/Vite es una SPA independiente. No incorporar Astro ni Studio a este repositorio.
- Mantener TypeScript strict. Presentación en features/components; red solo en services; validación compartida en shared; autorización real en SQL/Edge.
- Todas las tablas de restaurante deben tener RLS, índices y pruebas de aislamiento. Nunca aceptar un ID, una preferencia local o un checkbox CMS como autorización.
- Privilegios globales solo app_private.platform_administrators. No concederlos desde registro público, metadatos Auth o miembros de restaurante.
- Durante esta fase toda escritura Sanity pasa por el adaptador HTTP y exige dataset staging. No añadir flags de entorno, bypasses de administrador o endpoints directos para habilitar otros datasets.
- Los tokens de Sanity son secretos backend por integración. Ningún secreto con VITE_. No imprimir respuestas Auth, cabeceras o variables de entorno.
- Mantener integración exclusiva por proyecto/dataset. Compartir un dataset entre restaurantes requiere un modelo de autorización distinto y una migración revisada.
- Contratos de Sanity: fuente de verdad studio-salitre-restaurant/schemaTypes en commit f9cd750417306fbc6dd10de3fb29688856d2d915. Preservar campos desconocidos existentes al guardar. No createOrReplace ni borrar documentos publicados.
- Revisiones optimistas obligatorias en ediciones/publicaciones. Los diez bloques existentes conservan nombres, campos y claves.
- No introducir autenticación demo en producto. Los mocks solo viven en tests.
- Ejecutar npm ci, lint, format:check, typecheck, test, build y test:e2e. Edge: tsc -p tsconfig.edge.json y deno check mediante npm run check:edge. No marcar integraciones remotas como verificadas por pruebas con mocks.
- No ejecutar migraciones remotas, bootstrap, escrituras Sanity, merges o despliegues sin autorización explícita. CI solo usa bases de ensayo en memoria y mocks.
- PRs pequeñas cuando se continúe el desarrollo. No modificar web pública ni Studio sin justificar compatibilidad.
