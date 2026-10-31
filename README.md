# Restaurant Platform · Fase 2

Dashboard privado React + TypeScript + Vite para varios restaurantes, con Supabase Auth/PostgreSQL/RLS y edición de Sanity mediante Edge Functions. Aplicación separada de Astro y Studio; conserva los diez bloques de Salitre.

**Estado real:** implementación y pruebas locales; necesita configurar migraciones, usuarios, secretos y funciones en Supabase y desplegar Vercel para validar el recorrido remoto completo. Esta entrega no migra producción, no modifica documentos reales de Sanity ni configura webhooks. El backend solo permite escrituras Sanity en `staging` durante las pruebas. Las variables automáticas de Supabase tienen fallback público compatible y el override opcional `APP_SUPABASE_PUBLISHABLE_KEY`; no crees secretos personalizados con prefijo `SUPABASE_`. No hay autenticación simulada en la aplicación. Los tests usan servicios sustituidos y PostgreSQL aislado.

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
