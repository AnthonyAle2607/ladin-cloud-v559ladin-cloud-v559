# Arquitectura de la web de Criollo Cargo

Página pública de Criollo Cargo según el diseño `Diseños/Criollo Cargo Web.html`: inicio, tablero de zarpes,
rastreo, cotizador, preguntas, tienda en preventa (catálogo, ficha, carrito) y contacto por WhatsApp.

## Principio: un solo sistema, tres caras

```mermaid
flowchart LR
  subgraph Clientes
    W[Web pública<br/>criollo-cargo-web]
    M[App móvil<br/>caribe-cargo-app]
  end
  P[Panel interno<br/>public/ de este repo]
  subgraph Servidor["Servidor Express (este repo, Vercel)"]
    WEB["/api/web/* · web-publica.js"]
    TI["/api/tienda/* · tienda.js"]
    APP["/api/app/* · app-movil.js"]
    INT["/api/* del panel"]
    TA[tarifas.js]
  end
  DB[(Supabase Postgres)]
  ST[(Supabase Storage)]
  W --> WEB & TI
  M --> APP
  P --> INT & TI & WEB
  WEB & TI & APP & INT --> DB
  TI & APP --> ST
  WEB --> TA
```

La web, la app y el panel usan **el mismo servidor y la misma base**. Por eso:

- El tablero de zarpes muestra los contenedores reales del panel, con la ocupación calculada de sus etiquetas.
- El rastreo público consulta las mismas etiquetas y contenedores que ve el equipo.
- Cada producto de la tienda viaja en un contenedor del panel: su fecha de llegada es la del contenedor.
- El cotizador usa `tarifas.js`, la misma tabla de la calculadora del panel.
- Las solicitudes de la web y los pedidos de la tienda llegan al panel.

El navegador **nunca** habla con la base: todas las tablas tienen RLS y sin permisos para `anon`/`authenticated`.
Solo el servidor (con la clave secreta) lee y escribe.

## Decisiones

| Tema | Decisión | Motivo |
|---|---|---|
| Backend | Módulos nuevos en este servidor (`web-publica.js`, `tienda.js`, `tarifas.js`) | Mismos datos que el panel sin sincronizar nada; un solo despliegue en Vercel. |
| Frontend | Proyecto aparte `criollo-cargo-web` con **Next.js** en Vercel (próxima fase) | La tienda necesita SEO (fichas indexables) y páginas rápidas; el panel no lo necesita. |
| Pagos | **Manual** (Pago Móvil, Zelle, transferencia, Binance, efectivo). El cliente reporta la referencia y el panel confirma | Es como se cobra hoy en Venezuela; una pasarela se puede sumar después sin cambiar el modelo. |
| Cupo | Se **reserva al crear el pedido** (descuento atómico) y se devuelve si se cancela o vence (`TIENDA_HORAS_RESERVA`, 48 h) | Es preventa por contenedor: el cupo es limitado y no se puede vender dos veces. |
| Vencimientos | Revisión «perezosa» al leer o escribir la tienda (máx. una vez por minuto) | Vercel no mantiene procesos; no hace falta un cron. |
| Precios | Siempre los calcula el servidor | El navegador solo manda variante y cantidad. |
| Cuenta del comprador | **Sin registro**: el pedido se consulta con número + token (se entrega una sola vez) | Menos fricción; el cliente de carga ya tiene la app móvil. Se puede enlazar con `clientes` desde el panel (`cliente_id`). |
| Opiniones y estrellas | **No** se muestran hasta tener opiniones reales | El diseño trae calificaciones de ejemplo; publicarlas inventadas sería engañoso. |
| Rastreo público | Solo etapa, tipo de carga y fechas; nunca datos del cliente | Los números de etiqueta son fáciles de adivinar. Con límite de consultas por IP. |

## Modelo de datos (nuevas tablas)

Migración `supabase/migrations/20261103000000_web_tienda.sql` (el servidor también las crea al arrancar).

- `contenedores` + `publicar_web`, `fecha_cierre`, `capacidad_cbm` (68 por defecto), `ruta`.
- `web_solicitudes` — «Reservar espacio» (con la cotización recalculada en el servidor), contacto y «avísame» de la tienda.
- `tienda_categorias` — Ferretería, Electro, Hogar, Autopartes…
- `tienda_productos` — nombre, slug, categoría, origen, descripción y especificaciones (listas JSON), precio, precio anterior,
  nombre de la variante («Color», «Kit»…), **contenedor**, orden, publicado.
- `tienda_variantes` — nombre, SKU, **cupo** (unidades que caben en ese contenedor), precio propio opcional.
- `tienda_imagenes` — fotos en Storage (bucket privado `tienda`), servidas por el servidor.
- `tienda_destinos` — retiro en Valencia, Caracas, Maracaibo… con costo y días extra.
- `tienda_pedidos` y `tienda_pedido_items` — datos de contacto, destino, montos, método y referencia de pago, estado,
  vencimiento de la reserva, cliente enlazado; las líneas guardan nombre, variante y precio del momento.

Estados del pedido: `pendiente_pago → pago_reportado → pagado → en_camino → entregado`, más `cancelado` y `vencido`
(estos dos devuelven el cupo). El panel solo puede hacer las transiciones permitidas.

## API

### Pública (sin sesión)

| Ruta | Para qué sección del diseño |
|---|---|
| `GET /api/web/zarpes` | Cinta y tablero de zarpes: contenedor, ruta, cierre, llegada, ocupación %, estado (Abierto, Cierra pronto, Lleno, En tránsito…) |
| `GET /api/web/rastreo/:codigo` | Rastreo por etiqueta o contenedor: etapa 0–4 (Recepción, Consolidado, Zarpe, Altamar, Entrega) |
| `GET /api/web/tarifas` · `POST /api/web/cotizar` | Cotizador (mismo cálculo en el navegador y en el servidor) |
| `POST /api/web/solicitudes` | «Reservar espacio», contacto y «avísame» (`tipo`: `reserva`, `contacto`, `aviso_producto`; campo trampa `sitioWeb`) |
| `POST /api/web/encargos` | «Pídelo de China»: qué busca, enlaces, cantidad y hasta 3 fotos (multipart) |
| `GET /api/tienda/catalogo` | Tienda e inicio: categorías con conteo y tarjetas (precio, foto, contenedor, llegada, agotado) |
| `GET /api/tienda/productos/:slug` | Ficha: variantes disponibles, fotos, descripción, especificaciones y «En el mismo contenedor» |
| `GET /api/tienda/destinos` | Selector de entrega |
| `GET /api/tienda/imagenes/:id` | Fotos de productos publicados |
| `POST /api/tienda/pedidos` | «Pagar y reservar cupo»: crea el pedido y devuelve `numero`, `token`, total, vencimiento e instrucciones de pago |
| `GET /api/tienda/pedidos/:numero` | Estado del pedido (cabecera `X-Pedido-Token`) |
| `POST /api/tienda/pedidos/:numero/pago` | El cliente reporta la referencia de su pago |

### Panel (solo administrador)

`PUT /api/contenedores/:id/web` · `GET|PUT /api/web/solicitudes` · `GET|POST|PUT /api/tienda/admin/productos` ·
`POST /api/tienda/admin/productos/:id/imagenes` · `GET|DELETE /api/tienda/admin/imagenes/:id` ·
`GET|POST|PUT /api/tienda/admin/categorias` · `PUT /api/tienda/admin/destinos` · `GET /api/tienda/admin/pedidos` ·
`PUT /api/tienda/admin/pedidos/:id/estado`.

## Seguridad

- Límites por IP: formularios y pedidos (10 cada 15 min), rastreo y consulta de pedidos (30 por minuto).
- Validación de todo lo que entra; fotos verificadas por sus bytes; la API no revela el cupo exacto ni datos de clientes.
- Token de pedido aleatorio, guardado como hash y comparado en tiempo constante.
- CORS: `CORS_ORIGIN` debe incluir el dominio de la web (por ejemplo `https://criollocargo.com`).

## Variables de entorno nuevas

| Variable | Para qué |
|---|---|
| `TIENDA_INSTRUCCIONES_PAGO` | Texto con los datos de pago que se muestran al crear el pedido (si falta: «Tu asesora te escribirá…»). |
| `TIENDA_HORAS_RESERVA` | Horas que se guarda el cupo sin pago reportado (48). |
| `SUPABASE_BUCKET_TIENDA` | Bucket de fotos de productos (`tienda`). |
| `CORS_ORIGIN` | Añadir el dominio de la web. |

## Fases

1. **Base de la arquitectura (hecha):** esquema, migración, API pública y del panel, tarifas compartidas, pruebas.
2. **Panel (hecho, `public/web-tienda.js`, solo administrador):** menú «Web y tienda» con *Productos* (variantes y
   cupo, fotos, categorías, destinos), *Pedidos web* (confirmar pago, en camino, entregado, cancelar; WhatsApp al
   cliente) y *Solicitudes web* (reservas del cotizador con su estimado, contacto, marcar atendida); en la ficha del
   contenedor, «Publicar en la web» (cierre, capacidad, ruta). Pendiente: pasar la calculadora del panel a
   `/api/web/tarifas` para que nunca se separen.
3. **Web (hecha, proyecto `criollo-cargo-web`):** Next.js 16 con todas las secciones del diseño: inicio, zarpes,
   rastreo, cotizador, preguntas, tienda, ficha, carrito, pago con reserva de cupo y seguimiento del pedido. Las fotos de
   productos llevan `Cross-Origin-Resource-Policy: cross-origin` para poder mostrarse desde el dominio de la web.
   Pendiente: dominio, fotos y contenido (ver su README).
4. **Después:** avisos por WhatsApp o correo al cambiar el pedido, enlazar pedido pagado con cliente y etiqueta,
   pasarela de pago si se decide, opiniones reales.

## Carga masiva de productos (Excel o CSV)

`tienda-lote.js` (panel → Productos → «Carga masiva (Excel)»). Una fila por producto; la plantilla trae las columnas,
dos ejemplos y una hoja de instrucciones (`GET /api/tienda/admin/lote/plantilla`).

- **Revisar sin guardar** (`POST …/lote/analizar`): cada fila se valida con su número de fila (precio, cupos por
  variante, contenedor existente, nombres repetidos) y se indica si se **crea** o se **actualiza** (mismo nombre).
- **Cargar por tandas** de 25 (`POST …/lote/aplicar`) para no pasar el límite de 30 s de Vercel. Al actualizar, las
  variantes se emparejan por nombre (no se duplican) y las celdas vacías no borran categoría ni contenedor. Las
  categorías nuevas se crean solas. Las fotos (enlaces de 1688/Alibaba/Taobao/Yiwugo) se traen después, una por una,
  solo si el producto aún no tiene fotos.
- Guarda con la misma validación que el formulario (`persistirProducto` de `tienda.js`).

Corrección (noviembre 2026): un campo vacío («sin categoría», «sin contenedor») llegaba como id 0 y Postgres
rechazaba el producto por la llave foránea (en SQLite no se notaba). `intId` ahora devuelve null para vacío o 0.
Probado contra Postgres 17 con las migraciones, como en Supabase.

## Importador de productos de mercados chinos

`importador-1688.js` (panel → Productos → «Importar desde 1688»). Arma un **borrador sin publicar**: nombre, variantes,
descripción y especificaciones traducidos, enlace de origen, costo de referencia y un **precio sugerido**. El equipo
revisa, pone cupo y contenedor, y publica.

- **Vías:** capturas de la ficha y/o texto copiado (funciona ya con la IA del lector de packing list); enlace + API de
  un intermediario (OTAPI u otro) con `IMPORT_1688_URL` (plantilla con `{id}`, `{url}`, `{clave}`) e
  `IMPORT_1688_CLAVE`: la respuesta del proveedor, sea cual sea su formato, la interpreta la misma IA.
- **Precio sugerido:** tramo de precio que corresponde a la cantidad que se piensa comprar; costo en USD (los precios
  pueden venir en CNY o en USD: 1688 internacional ya muestra dólares) + envío dentro de China
  (`TIENDA_ENVIO_CHINA_PCT`, 8 %) + flete por m³ (caja de exportación ÷ unidades por caja; si solo hay medidas por
  unidad, +20 % de empaque y aviso de que es aproximado) + margen (`TIENDA_MARGEN_PCT`, 35 %). Tasa: `TIENDA_TASA_CNY`.
- **Fotos del proveedor:** `POST /api/tienda/admin/productos/:id/imagenes-remotas` solo baja de dominios de mercados
  chinos (alicdn, 1688, taobao, tmall, yiwugo…), por HTTPS, sin redirecciones, con tope de 6 MB y validando los bytes.
- **Búsqueda y enlaces con Apify** (`IMPORT_APIFY_TOKEN`; actor `hezgLkHcDL7dwaDHo`, «1688 Product Scraper», de pago por
  producto): el panel lanza el trabajo (`POST /api/tienda/admin/importar/apify` con `q` o `enlaces`) y consulta cada 4 s
  (`GET …/importar/apify/:run`) hasta que termina: así ninguna llamada pasa de los 30 s de Vercel. La búsqueda devuelve
  tarjetas con título traducido, foto, precio, pedido mínimo y proveedor; las marcadas se descargan en un solo trabajo y
  cada ficha (`crudo`) la traduce y normaliza la IA antes de crear su borrador. El actor no trae medidas de la caja:
  el precio sugerido avisa que no incluye flete. Probado con un Apify simulado (misma API y forma de salida).
- **Búsqueda con otro intermediario:** `IMPORT_1688_BUSQUEDA_URL` (plantilla con `{q}`, `{pagina}`, `{desde}`, `{clave}`).
  La lista de productos se encuentra en la respuesta sin depender de su formato (OTAPI, TMAPI, Apify…); si no es JSON,
  la saca la IA.
- **Velocidad:** usa primero los modelos «lite» (`IMPORT_IA_MODELO` para fijar otro orden): una ficha se lee en
  4–10 s; con el modelo que razona tardaba ~30 s, al límite de Vercel.
- Probado con una ficha real de 1688 (texto y captura). La tienda pública no expone el origen ni el costo.
- «Crear y seguir con otro» encadena varios productos sin cerrar la ventana; con API configurada, se pueden pegar
  varios enlaces (uno por línea) y cada uno queda como borrador. Si falta la migración 20261104, el producto se guarda
  igual (sin su enlace de origen) y el panel lo avisa.

## «Pídelo de China» (encargos)

Para lo que no está en la tienda. La web (`/encargos`) recibe qué busca el cliente (descripción, hasta 5 enlaces,
cantidad y hasta 3 fotos) y cómo contactarlo; llega al panel en *Solicitudes web* como «Pídelo de China». El equipo lo
cotiza con el importador («Abrir en el importador» trae el primer enlace ya pegado) y responde por WhatsApp.

- **Por qué no se busca en vivo en la tienda:** cada búsqueda de un visitante gastaría Apify e IA sin control, tardaría
  más de lo que espera un comprador y mostraría precios de proveedor sin flete, cupo ni revisión. Así el gasto solo
  ocurre cuando el equipo decide cotizar.
- `encargos.js`: `POST /api/web/encargos` (multipart; límite 6 cada 15 min por IP; campo trampa `sitioWeb`; fotos
  verificadas por sus bytes, JPG/PNG/WEBP, 4 MB cada una) y `GET /api/web/solicitudes/:id/fotos/:fotoId` (solo
  administrador). Las fotos van al bucket privado `tienda` (`encargos/s{id}/…`), tabla `web_solicitud_fotos`.
- La web reduce las fotos en el navegador (lado mayor 1600 px, JPEG) antes de enviarlas: Vercel no acepta cuerpos de
  más de ~4,5 MB. Una foto de teléfono de 7 MB queda en ~0,2 MB.
- Migración `20261105000000_encargos.sql` (tipo `encargo` y tabla de fotos). **Sin ella** el encargo no se pierde: se
  guarda como contacto con la marca `[Encargo]`, sus enlaces y cantidad, y una nota de que mandó fotos (las fotos no se
  suben).
- Probado contra Postgres 17 con y sin la migración (19 comprobaciones) y en el navegador (web → panel → importador).

## Pendiente de decidir

- Datos de pago reales (cuentas, teléfono de Pago Móvil, correo de Zelle) para `TIENDA_INSTRUCCIONES_PAGO`.
- Dominio de la web y del panel.
- Tarifas terrestres: el diseño y el panel difieren en algunos estados (el panel no tiene Carabobo ni Nueva Esparta y
  tiene «Oriente»). `tarifas.js` usa la tabla del diseño; hay que confirmarla.
- Contenido de las preguntas frecuentes y textos legales (términos de la preventa, devoluciones).
