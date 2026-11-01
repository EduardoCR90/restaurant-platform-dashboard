# Fase 5 · Iteración 2 — Temas y composición

Contrato visual canónico: `restaurant-astro-template` **v0.2.0**, commit `7340551f48a5f95e75d035ff70fb5c93f18d919a`. `visual-contract.lock.json` fija el archivo portable y su SHA-256; la prueba de integridad impide mantener un modelo visual divergente. No editar esa copia de forma independiente. Para ampliar el contrato, publicar primero una versión del template y actualizar copia, manifiesto y pruebas coordinadamente.

## Edición

El dashboard es el punto de gestión del restaurante. En Configuración → Identidad visual se puede elegir Elegant, Modern o Casual y personalizar colores, fuentes, espaciado, ancho, botones y variantes. La confirmación al cambiar preset elimina únicamente los overrides visuales gestionados. Restablecer un campo permite heredar del preset. Las personalizaciones se guardan como valores opcionales; abrir el formulario no escribe defaults.

Las páginas permiten añadir, ordenar, ocultar/mostrar y eliminar con confirmación los diez tipos de bloque existentes. Las variantes usan los mismos componentes, sin copias por tema. Quitar un bloque no elimina imágenes ni documentos relacionados. Añadir el primer bloque o retirar el último avisa del cambio entre composición original y bloques. Sin bloques se puede controlar la visibilidad de las secciones históricas sin convertirlas. Ocultar todos los bloques mantiene una composición vacía, sin reactivar accidentalmente el diseño original.

Guardar crea/actualiza un borrador; Publicar utiliza el flujo existente con revisión optimista y seguimiento de despliegue. Se mantiene el aviso de cambios sin guardar. No hay escrituras ni dispatch adicionales desde el selector visual. Las categorías y platos siguen siendo dinámicos.

## Despliegue y seguridad

Orden: template v0.2.0 → instancia Astro compatible → dashboard y Edge Functions → schemas/Studio. La API anuncia `visualContractVersion: 2`; el nuevo editor oculta las funciones incompatibles hasta recibir esa capacidad. Un cliente anterior no puede guardar documentos visuales nuevos perdiendo sus campos. No se amplían permisos: cada petición sigue exigiendo autenticación, membresía, módulo y la integración autorizada, con la excepción exacta de Salitre production y staging conservado.

No requiere migración SQL, nuevos secretos ni modificación de documentos. Los campos y referencias anteriores se conservan, incluidos metadatos desconocidos de servidor. Sin preset, Salitre conserva su configuración y diseño históricos. El frontend utiliza fallbacks seguros para variantes futuras; el backend rechaza estilos no admitidos.

## Validación sin datos reales

- Template: contratos, presets, límites/contraste, aislamiento, builds y navegador de los tres estilos a 390/1440 px.
- Dashboard: permisos/revisiones/preservación de campos y pruebas de formulario. E2E con API local de ensayo: preset → guardar → publicar y bloques → ocultar → ordenar → recargar → eliminar con confirmación.
- Studio: campos opcionales, variantes y hash del contrato; check y build.
- Salitre: cuatro páginas comparadas con el commit anterior fijado en CI, en móvil/escritorio, con geometría, estilos y PNG idénticos. Fotos sintéticas y demo; no hay escrituras de prueba en Sanity.

Para revisar desde el navegador: entrar con un usuario autorizado, abrir configuración sin guardar y comprobar los controles. Una prueba real de cambio visual exige guardar/publicar deliberadamente; el despliegue de esta iteración no cambia contenido por sí solo. No usar este procedimiento como autorización para modificar otros restaurantes.
