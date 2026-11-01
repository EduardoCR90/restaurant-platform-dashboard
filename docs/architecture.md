# Arquitectura y decisiones

## Separación de responsabilidades

```text
src/app/                  Router, layout, guard de sesión
src/components/           Feedback y estados de carga
src/features/auth/        Login, recuperación, renovación y perfil activo
src/features/restaurants/ Contexto validado, selector y resumen real
src/features/content/     Formularios, diez bloques y editor de borradores
src/features/modules/     Contratación/activación/estado de implementación
src/features/settings/    Perfil, configuración y administración global
src/services/             SDK Supabase y cliente Edge, fronteras con Zod
src/styles/               Tokens y CSS responsive, sin framework de estilos
shared/                   Contratos y servicio editorial portable
supabase/migrations/      Modelo, privilegios, triggers y RLS
supabase/functions/       JWT, autorización, API Sanity y administración
supabase/bootstrap-salitre.sql   Inicialización explícita, sin usuarios ficticios
 tests/                   PostgreSQL, unidades, RTL y navegador
```

La UI no construye consultas SQL ni GROQ. El servicio frontend consulta Supabase con la sesión del usuario. AuthProvider recupera sesión y valida usuario con `getUser`, después exige perfil activo. RestaurantProvider solo selecciona restaurantes retornados por RLS. Una preferencia local es únicamente una preferencia; IDs manipulados no dan acceso. Cambiar restaurante vuelve al resumen y desmonta el editor del tenant anterior.

El módulo de contenido llama a Edge, que verifica la identidad en Auth, ejecuta `authorize_content` con el JWT del usuario y resuelve los identificadores/secretos de la integración en backend. El cliente no proporciona proyecto/dataset/token. Sanity se consulta sin CDN y con perspectiva raw para editar; Astro mantiene su lectura published y su despliegue estático.

## Decisiones

- CSS moderno: una identidad propia de producto, sin reutilizar la marca Salitre, sin dependencias visuales adicionales.
- Zod compartido en frontend/Edge, para los campos reales del Studio. Las reglas SQL y sus permisos no dependen del navegador.
- Proyecto/dataset de Sanity exclusivo por restaurante. Se impide una integración duplicada con UNIQUE. No se añade un restaurantId ficticio a los esquemas existentes ni se comparte accidentalmente contenido.
- Sanity es la única fuente editorial. PostgreSQL guarda cuentas, acceso, módulos e integraciones; no duplica platos o páginas.
- No signup público. Invitaciones y operaciones comerciales son administrativas y quedan fuera del cliente normal.
- Módulos futuros tienen registro tipado, estado pendiente y ninguna ruta funcional. Contratación, activación y rol son comprobaciones separadas.
- No service_role en operaciones editoriales: RLS se aplica al JWT. El backend administrativo usa service_role solo después de verificar administrador global activo, y la RPC valida el actor nuevamente.
- No SDK Sanity ni token de escritura en el bundle. Edge usa la API HTTP fijada de Sanity; timeout y errores sanitizados.
- No biblioteca pesada para editor: formularios tipados de bloques y Portable Text estructurado. No se interpreta HTML arbitrario.

## Nuevos restaurantes

Un administrador crea restaurante, configura estado, asigna membresías, concede módulos, activa operación y añade una integración exclusiva con contrato salitre-v1. Un operador configura el token para ese integration.id en los secretos de Edge. No se duplica React. Otro contrato editorial requiere su adaptador/versionado y pruebas; no se afirma compatibilidad automática con cualquier CMS.

Las webs públicas pueden conservar diseños propios siempre que consuman este contrato común. Salitre y Studio no han sido modificados en esta fase.

## Publicación observable

[Iteración 4](publication-tracking.md): registro de operaciones sin contenido editorial, evidencia de la misma instantánea GROQ y callbacks OIDC del workflow Pages existente. No hay un segundo disparador. La edición no espera a que termine el despliegue.
