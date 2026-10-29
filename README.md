# Ladin Cloud v36

Mejoras incluidas:
- Mejor interlineado y espaciado general de textos.
- Sección de incidencias/quejas con formulario de registro operativo estructurado.
- Datos de incidencia: fecha, código asesor, código cliente, código etiqueta, área, tipo, impacto, detalle y evidencia.
- Administrador puede revisar y responder incidencias desde un formulario claro.
- Las asesoras pueden consultar sus propias incidencias y ver la respuesta del administrador.
- Respuestas se guardan con estado y fecha de respuesta.


V49: alertas de salud de clientes en selector: ⚠️ si alguna etiqueta tiene error, ✅ solo si todas están 100% correctas; validación estricta de cajas, CBM, mercancía y contenedor/fecha cuando corresponde.


Cambios v53: Cartera y mercancía con botón Actualizar, estados por etapa (atención/China/tránsito/Venezuela/completado), validación por parámetros y Ver cliente con detalle de compras/etiquetas.


CALCULADORA CBM v54: incluye tarifa base de $660/CBM, extras por tipo de mercancía y volumen, modalidad Puerta a Puerta o Retiro en Valencia y tarifa terrestre aproximada por destino.


V546: detalles de contenedor con CBM Totales para administradores y etiquetas asociadas en bloques clicables que abren los detalles de cada etiqueta.


## API de la app móvil de clientes (Caribe Cargo)

Código en `app-movil.js`. Los clientes entran con su **código de cliente** (`LC-CLI-000001`) y una **clave** que define el personal; su token (`typ: cliente`) solo sirve en `/api/app/*`, y el token del personal no sirve ahí.

**Rutas de la app** (con `Authorization: Bearer <token>`; cada consulta se limita al cliente de la sesión):
`POST /api/app/login` · `GET /api/app/etiquetas` · `GET /api/app/etiquetas/:id` · `GET /api/app/fotos/:id` · `GET /api/app/avisos` · `GET|PUT /api/app/preferencias` · `POST /api/app/dispositivos`

**Rutas del personal** que la alimentan (admin o la asesora del cliente):
- `PUT /api/clientes/:id/clave` — `{ clave }` (mínimo 8 caracteres) crea o cambia el acceso del cliente a la app.
- `PUT /api/etiquetas/:id/lotes` — `{ lotes: [{ nombre, cajas, kgPorCaja, largoCm, anchoCm, altoCm }] }` reemplaza los lotes (el peso total se calcula).
- `POST /api/etiquetas/:id/fotos` — multipart con `fotos` (JPG/PNG, máx. 10 de 8 MB), `titulo`, `lugar`. Se validan por sus bytes y se guardan en `uploads/etiquetas/` (no público).
- `DELETE /api/etiquetas/:id/fotos/:fotoId`

**Avisos:** al cambiar el estado de una etiqueta (`PUT /api/etiquetas/:id`) o subir fotos se guarda un aviso para el cliente y, si tiene dispositivos registrados y la preferencia activa, se envía una notificación push por Expo (`https://exp.host/--/api/v2/push/send`). Mapa de estados: preparando sin contenedor → *En almacén*; preparando con contenedor → *Consolidado*; `transit` → *En tránsito*; `ve` → *En puerto*; facturado/entregado/cerrado → *Entregado*.

Variable opcional `APP_WHATSAPP` (número con código de país): activa el botón «Escribir a mi asesora» de la app.

Las tablas nuevas (`etiqueta_lotes`, `etiqueta_fotos`, `cliente_preferencias`, `cliente_dispositivos`, `cliente_avisos` y la columna `clientes.clave_hash`) se crean solas al arrancar, en Postgres y en SQLite.
