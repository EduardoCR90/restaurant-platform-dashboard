# Fase 5 cerrada · template y permisos definitivos

## Roles

| Operación                                                            | Super Admin activo                              | Admin cliente (owner/manager)                              |
| -------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Crear restaurantes, asignar usuarios/integraciones                   | Sí, backend administrativo                      | No                                                         |
| Seleccionar template y versión aprobada                              | Sí, control optimista/auditado                  | Solo consulta                                              |
| Diseño global, logo, preset, branding, variantes y layout de bloques | Sí, tras autorización editorial del restaurante | No                                                         |
| Crear/quitar/cambiar tipo de bloques                                 | Sí                                              | No                                                         |
| Contenidos, platos, precios, categorías, SEO, imágenes editoriales   | Sí                                              | Sí, con membresía, módulo y restaurante activos            |
| Ordenar u ocultar/mostrar bloques y secciones existentes             | Sí                                              | Sí                                                         |
| Guardar, publicar, retirar, recuperar o descartar contenido          | Sí                                              | Sí, si no publica/descarta cambios de diseño privilegiados |
| Conceder o activar módulos operativos                                | Sí, backend y RPC auditada                      | Solo consulta                                              |
| Consultar publicación, despliegue y versión instalada                | Sí                                              | Sí, de su restaurante                                      |

`restaurant_owner` y `restaurant_manager` se conservan como roles de Admin cliente; no se renombran ni se elevan. Super Admin sigue exclusivamente en `app_private.platform_administrators` con perfil activo. La UI es orientativa: Edge vuelve a autenticar y autorizar cada operación. No se utilizan metadatos JWT, preferencias CMS ni flags del cliente como autoridad.

El servicio editorial compara tema/logo y la estructura/propiedades visuales de cada bloque con el documento de servidor. El orden y `enabled` no son diseño. Para guardar se contrasta el borrador actual; para publicar, recuperar o descartar, se comprueban las diferencias privilegiadas con la publicación. No se puede publicar indirectamente un cambio visual hecho por otro editor. Los campos que el cliente no ve se conservan, no se borran por ocultar controles. Los textos y enlaces de las composiciones históricas siguen siendo editoriales; su estructura original no se convierte ni reordena como un layout nuevo.

La migración `202611010001_template_governance.sql` revoca la actualización REST directa de `restaurant_modules.enabled` y cierra su antigua política. Solo la RPC `admin_website_configure` de service_role puede activarlos, después de validar de nuevo el actor Super Admin y la contratación. No cambia ninguno de los valores existentes, membresías, integraciones o documentos.

## Versión seleccionada, validada e instalada

- Cada instancia fija versión/commit/SHA-256 en `template.lock.json` y declara compatibilidad en `template.instance.json`.
- `template_releases` es un catálogo inmutable de releases revisadas, no datos proporcionados por el navegador. `ops/template-releases.json` es su origen revisable; nunca actualizar una identidad existente con otro commit/hash.
- `restaurant_websites` separa `desired_*` de `installed_*`. Seleccionar una versión crea una solicitud, no ejecuta ni anuncia un despliegue. Se rechazan revisiones desactualizadas, downgrades, majors y cambios de template incompatibles con una instancia instalada.
- El operador Super Admin ejecuta el actualizador del repositorio privado del template desde una rama limpia de la instancia. Verifica integridad/contratos/origen/ref, prepara un worktree aislado, instala sin lifecycle hooks y ejecuta check/tests/build/check:build antes de aplicar solo vendor y locks. Un fallo deja intacta la instancia. El recibo `template.update.json` solo significa `validated-not-deployed`.
- La PR de instancia y su CI son obligatorias antes de integrar. El workflow existente de producción valida el snapshot real de Sanity y publica el sitio. No se añade ningún dispatch editorial.
- La misma evidencia de build incorpora la identidad íntegra del template. La Edge `publications` verifica el OIDC del main registrado y su repository ID, y la base exige una evidencia `ready` idéntica y un informe `succeeded` del mismo run/intento/commit antes de registrar instalación. No basta un formulario, un recibo local, una selección o una build. Repeticiones y callbacks antiguos no hacen retroceder la versión.

El cliente ve la versión instalada/seleccionada y el run verificado en Configuración. El selector solo aparece para Super Admin. La ejecución automatizada de trabajos de aprovisionamiento se implementará en fase 6; la actualización de instancias dispone ya de una herramienta reutilizable y validada, sin incorporar un servicio de flota.

## Despliegue de esta fase

1. Publicar el template v0.3.0 con su CI aprobada. Contratos editoriales y visuales permanecen compatibles con 0.2.0.
2. Actualizar catálogo y manifest del contrato portable desde ese commit inmutable. No editar `shared/platform-contract.ts` de forma independiente.
3. Tras integrar la PR del dashboard y aprobarse su CI de main, **Roll out validated platform main** llama al workflow reutilizable de configuración con el SHA exacto validado y `apply`. También se conserva **Configure template governance (manual)** para `inspect`/`apply`. Usa exclusivamente `SUPABASE_ACCESS_TOKEN` ya existente en Secrets. Aplica solo la migración revisada si el esquema está ausente; se detiene ante esquema parcial o releases en conflicto. Nunca ejecuta bootstrap ni escribe en Sanity. La restricción de módulos es un cambio de permisos deliberado requerido por esta fase.
4. El mismo rollout llama después al workflow existente **Deploy Supabase Edge Functions**, ahora reutilizable y también manual, que valida y despliega content, platform-admin y publications. Ambos checkouts quedan fijados al SHA validado; el flujo automático exige CI verde del main actual del mismo repositorio. Vercel despliega el dashboard desde main.
5. Integrar Salitre v0.3.0 con tracking del template. Su workflow Pages/OIDC habitual confirma instalación. Revisar Configuración y Actions.

No requiere nuevos secretos, cambios de UUID de integración, DNS, CNAME, webhook, bootstrap ni migración de contenido. La excepción exacta de Salitre/hfa8zkyw/production y staging se conservan.

## Contrato para fase 6

El template es la fuente de `platform-contract.ts`, distribuido byte a byte con versión/commit/SHA en `platform-contract.lock.json`. `provisioningSpec` valida request UUID, restaurante, release aprobada, diseño, módulos contratados/activos, asignaciones, integración Sanity dedicada y repositorio/origen/base/dominio personalizado. No acepta tokens, actor administrativo ni scripts arbitrarios.

No hay ejecutor, creación de recursos o cambios DNS en fase 5. El futuro aprovisionador debe verificar Super Admin y resolver de nuevo catálogos/IDs/propiedad en servidor, comprobar exclusividad del proyecto/dataset, propiedad del dominio y disponibilidad, persistir progreso idempotente y comprobar los despliegues. Validar un plan no concede acceso de escritura a production: la política de integración debe seguir siendo explícita. Los clientes no reciben acceso directo de escritura a Sanity/Studio; sus credenciales independientes quedarían fuera del límite del SaaS.

## Validación y límites

Tests de servicio: manipulación de theme/logo/layout/alignment/spacing, bloques nuevos/eliminados/retype, publicación/restauración/descarte de drafts privilegiados, cliente sin capability, permisos de tenant y controles Super Admin. PostgreSQL PGlite ejecuta las migraciones reales: módulos/roles suspendidos, catálogo inmutable, revisión optimista, RLS y registro exclusivo de builds exitosas, replays y callbacks antiguos. E2E usa una API local de ensayo con ambos roles; no publica documentos reales. La comprobación final remota usa lectura de revisiones, páginas públicas y bloqueo 401, sin cambiar contenido para probar.
