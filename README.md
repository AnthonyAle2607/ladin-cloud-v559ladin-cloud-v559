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


## Facturación, comisiones e importación (panel administrativo)

Pantallas nuevas del menú **Finanzas** (`public/facturacion.js`) y su servidor (`facturacion.js`, `importador.js`, `usuarios.js`):

- **Facturación**: factura de servicios (formato *Factura_Servicios*): cliente, líneas con cajas / CBM / peso, flete marítimo (660 $/CBM por defecto), traslado terrestre y extra de despacho. Se arma desde las etiquetas del cliente que aún no están facturadas. PDF por factura, pagos (abonos) con estado pendiente / parcial / pagada y anulación. Un cliente con facturas no se puede borrar.
- **Comisiones**: se generan al emitir cada factura con la regla del asesor (o la global): porcentaje del total, porcentaje del flete o monto fijo por CBM. **Sin regla definida las comisiones salen en $0.00** hasta que el administrador la configure. Cada asesor ve solo las suyas, por cliente; el administrador las marca como pagadas y puede recalcular las pendientes (las pagadas nunca se tocan).
- **Importar datos**: clientes, contenedores y etiquetas desde Excel o CSV, con mapeo automático de columnas, simulacro antes de guardar, conservación de los códigos de cliente tal cual (por ejemplo `2-W2089S`) y lista de filas con error.
- **Acceso a la app móvil** (en la ficha del cliente) y **lotes y fotos** (en la ficha de la etiqueta).
- Rutas que la web ya llamaba y no existían: `POST/PUT /api/usuarios`, `GET /api/portfolio`, `POST /api/admin/import-clients`.

Permisos: solo el administrador emite facturas, anula, registra pagos, cambia reglas, importa y paga comisiones; los asesores solo leen lo suyo.
