# Restaurant Platform · Fase 2

Dashboard privado React + TypeScript + Vite para varios restaurantes, con Supabase Auth/PostgreSQL/RLS y edición de Sanity mediante Edge Functions. Aplicación separada de Astro y Studio; conserva los diez bloques de Salitre.

**Estado:** las iteraciones 1–3 están integradas y el propietario ha validado el flujo editorial real de Salitre. La iteración 4 añade seguimiento de publicaciones y despliegues, conservando la política de production y el webhook existentes. Consulta [instalación, estados y validación](docs/publication-tracking.md). Los tests usan servicios de ensayo; no modifican contenido real.

## Arranque

Node 22.22+ y npm. Desde Codex Cloud también puedes usar los workflows de la PR; no necesitas un ordenador local para revisar el código.

```bash
npm ci
cp .env.example .env
npm run dev
```

Abre http://localhost:5173. Las variables públicas apuntan a `wanrzgumoamryuybmopa`. Sin migraciones/perfil/membresía no tendrás acceso al dashboard; esto no se oculta con datos demo. No hay registro público.

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run preview
npm run test:e2e
npm run check:edge # requiere Deno 2
```

`npm test` incluye aislamiento RLS real con PostgreSQL WASM (PGlite), interfaces RTL y operaciones editoriales con un adaptador de ensayo. Playwright sustituye Auth/REST/Edge y no modifica los proyectos remotos. Para Chromium instalado: `CHROME_BIN=/usr/bin/chromium npm run test:e2e`. En otro equipo: `npx playwright install chromium`.

## Guías

- [Arquitectura y decisiones](docs/architecture.md).
- [Configurar Supabase, SQL, usuarios y funciones](docs/supabase.md).
- [Roles, RLS y límites de confianza](docs/security.md).
- [Contratos Sanity y edición](docs/sanity.md).
- [Vercel, móvil y trabajo desde Codex Cloud](docs/deployment.md).
- [Despliegue manual de Edge Functions desde GitHub](docs/edge-deployment.md).
- [Pruebas, estado real y limitaciones](docs/testing.md).

No pegues tokens en el chat. Los secretos solo se configuran en Supabase/GitHub/Vercel según corresponda. La publishable key es pública; RLS y las Edge Functions deciden los permisos.

## Compatibilidad editorial — iteración 1

[Inventario completo, contrato y validación coordinada](docs/editorial-compatibility.md). Los nuevos campos son opcionales; la barrera backend de staging sigue intacta.

## Iteración 2 — Salitre production

[Política, configuración segura, despliegue y validación](docs/salitre-production.md). Conserva la integración existente y no modifica permisos de otros restaurantes.

## Iteración 3 — Gestión editorial

[Acciones, estados, referencias y protección de cambios](docs/editorial-actions.md). Descarta drafts, retira de forma reversible y recupera contenidos sin borrar publicaciones ni perder cambios locales.

## Iteración 4 — Publicación y despliegues

[Estados, correlación verificable, OIDC, migración y operación](docs/publication-tracking.md). Sanity sigue siendo la fuente editorial; Supabase solo guarda metadatos del proceso.

## Fase 5 · Variantes visuales y composición

[Contrato, controles editoriales, despliegue y validación](docs/visual-themes.md). Presets Elegant/Modern/Casual y variantes opcionales, sin migrar contenido.

## Fase 5 · Consolidación y permisos

[Versiones, actualizaciones seguras, permisos definitivos y contrato de fase 6](docs/template-governance.md). La activación de módulos y el diseño son exclusivos de Super Admin.

## Fase 6 · Aprovisionamiento de Sanity

[Servicio, idempotencia, cifrado, recuperación y configuración](docs/sanity-provisioning.md). Solo Super Admin puede crear la base editorial; las pruebas no crean proyectos reales y Salitre permanece intacto.
