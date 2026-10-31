# Iteración 2: Salitre en production

## Política backend

`staging` conserva el comportamiento anterior para todas las integraciones ya autorizadas. La única excepción a otros datasets es la tupla completa configurada en `SALITRE_PRODUCTION_WRITE_TARGET`:

```json
{
  "restaurantId": "UUID_REAL_SALITRE",
  "integrationId": "UUID_EXISTENTE_INTEGRACION",
  "projectId": "hfa8zkyw",
  "dataset": "production"
}
```

No es un booleano ni una lista abierta de proyectos. El parser exige exactamente esos cuatro campos, UUID válidos, hfa8zkyw y production literales. Una tupla distinta se deniega antes de HTTP; una configuración ausente deniega production. Una configuración inválida no impide staging. Nunca se expone el valor al frontend.

Cada petición verifica Bearer con Auth.getUser, llama a authorize_content con el JWT del usuario y lee la fila de restaurant_integrations con ese JWT y RLS. El servidor contrasta UUID de integración/restaurante y proyecto/dataset con lo autorizado por la RPC. Si cambian entre lecturas, detiene la operación. No usa service_role para editar contenido ni confía en proyecto/dataset/política recibidos del navegador. Las membresías, roles, estado y módulo siguen siendo obligatorios.

La barrera común del adaptador HTTP protege borradores, publicación y assets. La publicación mantiene sus dos revisiones y la transacción existente. No hay permiso nuevo para otros restaurantes/proyectos, ni eliminación de documentos publicados, reintentos de escrituras o cambios en RLS.

## Configuración mediante GitHub Actions

Workflow nuevo: **Configure Salitre production (manual)**, solo workflow_dispatch desde main, sin re-runs. Comparte concurrencia con el despliegue Edge. Usa únicamente el secreto existente `SUPABASE_ACCESS_TOKEN`, entregado al paso operativo después de tests sintéticos. El runner solo necesita Node y los scripts builtin, no instala dependencias con credenciales presentes.

El token de gestión debe poder consultar la base de wanrzgumoamryuybmopa y leer metadatos/escribir secretos Edge. Se usa la [Management API de Supabase](https://supabase.com/docs/reference/api/introduction), nunca se recuperan valores de secretos existentes. La cuenta operadora debe tener acceso a este proyecto; el secreto no se copia a Codex, logs ni Vercel.

1. Integrar la PR con CI aprobada.
2. Ejecutar el workflow con operation=inspect. Solo realiza SELECT sobre la integración de slug salitre. Comprueba que hay exactamente una, proyecto hfa8zkyw, contrato salitre-v1, estado activo y módulo concedido/activo. Muestra solo los UUID no secretos, proyecto y dataset actual.
3. Ejecutar operation=apply con los UUID obtenidos en expected_restaurant_id y expected_integration_id y confirmation=`HABILITAR SALITRE PRODUCTION`. La autorización de esta operación ha sido concedida para esta iteración; no concede autorización a destinos distintos.
4. El script vuelve a inspeccionar, exige SANITY_TOKENS existente y configura únicamente el secreto nuevo SALITRE_PRODUCTION_WRITE_TARGET. Si ya existe uno con digest diferente, se detiene **sin sobrescribirlo**. Verifica el digest sin leer el valor.
5. Actualiza solo external_dataset de la integración existente, mediante una operación SQL transaccional guardada por ambos UUID, slug, proyecto, dataset anterior y contrato. No recrea el restaurante/integración ni repite bootstrap. Si ya está aplicado, solo verifica. No toca SANITY_TOKENS, otros secretos, membresías, módulos o filas de otros restaurantes.
6. Ejecutar **Deploy Supabase Edge Functions** desde main. Usa la CLI fijada y despliega content/platform-admin con verify_jwt=false; ambas verifican Auth.getUser. No ejecuta migraciones ni bootstrap. El adaptador antiguo deniega production hasta que esté desplegado el nuevo.

Si falla después de crear el nuevo secreto pero antes de actualizar la fila, puede quedar una política estrecha sin usar: revisar el estado antes de continuar. No hay rollback destructivo, borrado ni sobrescritura automática. Si el token no tiene permisos de gestión suficientes, los pasos manuales siguientes sustituyen la configuración; no compartas tokens en el chat.

## Alternativa manual exacta (solo si falta acceso de gestión)

En Supabase → proyecto restaurant-platform-dev (wanrzgumoamryuybmopa) → SQL Editor, ejecutar primero la consulta SELECT `inspectQuery` de scripts/salitre-production.mjs. No volver a ejecutar bootstrap-salitre.sql.

En **Edge Functions → Secrets**, añadir SALITRE_PRODUCTION_WRITE_TARGET con el JSON anterior y los UUID reales. No modificar una política existente diferente sin revisarla. Conservar SANITY_TOKENS y su clave UUID existente: el token Sanity correspondiente debe tener lectura/escritura en hfa8zkyw/production y assets; nunca usar una variable VITE_. No crear secretos personalizados SUPABASE_*.

En SQL Editor, ejecutar la operación guardada generada por `updateQuery` en el mismo script con esos dos UUID. Solo actualiza public.restaurant_integrations.external_dataset a production cuando coinciden identidad, slug salitre, proveedor sanity, proyecto hfa8zkyw, dataset staging/production y contrato. Si ya está en production, no actualizar. Confirmar mediante SELECT que mantiene el mismo id y restaurant_id. No realizar UPDATE por nombre únicamente ni cambios masivos.

Después ejecutar el workflow de despliegue manual existente. Las variables públicas Vercel no cambian y no se necesita una migración SQL de esquema, un dataset nuevo ni un token Sanity en GitHub para el dashboard.

## Validación y límites

- `npm test`: positivos y negativos de la tupla, contexto desde Supabase, RLS/roles, borradores, lectura y aislamiento con HTTP sustituido. Ningún test toca Sanity real.
- `node --test scripts/salitre-production.test.mjs`: inspección/configuración simulada, no sobrescribir secretos, IDs/confirmación, idempotencia, ausencia de credenciales y errores sanitizados.
- lint, formato, TypeScript React/Edge, build, Deno check y empaquetado localhost verifican las dependencias nuevas. Playwright usa endpoints interceptados.
- En remoto: verificar workflow de configuración y despliegue, función sin Bearer debe devolver 401, integración conserva UUID y apunta a production.
- Validación editorial real requiere una sesión owner/manager (o administrador autorizado) en el dashboard: abrir contenido, guardar un borrador, comprobar que no cambia la web, publicar y comprobar la reconstrucción Pages y el cambio visible. No inventar cuentas ni eludir Auth para dar por hecha esa prueba.
- El webhook/Pages existente no se configura de nuevo. Si falla el despliegue web, el mensaje del dashboard sigue distinguiendo publicación CMS de reconstrucción pendiente; el seguimiento completo de despliegues pertenece a la iteración posterior.

La excepción no equivale a una comprobación de que el token Sanity existente tenga permisos correctos. Nunca afirmar una publicación real por el éxito de un test mock, de un cambio de configuración o del despliegue Edge.
