/**
 * Tienda en preventa de la web de Criollo Cargo. Cada producto viaja en un contenedor del panel (contenedor_id), así
 * la fecha de llegada de la tienda es la misma que ve el equipo. El precio y el cupo se calculan SIEMPRE aquí: el
 * navegador solo manda qué variante y cuántas.
 *
 * Público (sin sesión):
 *   GET  /api/tienda/catalogo                 → categorías y productos activos (tarjetas)
 *   GET  /api/tienda/productos/:slug          → ficha: variantes, fotos, descripción, «en el mismo contenedor»
 *   GET  /api/tienda/destinos                 → entrega: retiro en Valencia o traslado (costo y días extra)
 *   GET  /api/tienda/imagenes/:id             → foto del producto
 *   POST /api/tienda/pedidos                  → crea el pedido y RESERVA el cupo; devuelve número y token de consulta
 *   GET  /api/tienda/pedidos/:numero          → estado del pedido (cabecera X-Pedido-Token)
 *   POST /api/tienda/pedidos/:numero/pago     → el cliente reporta su pago (referencia)
 *
 * Panel (solo administrador): /api/tienda/admin/… productos, fotos, categorías, destinos y pedidos.
 *
 * Pago manual (Pago Móvil, Zelle, transferencia…): el pedido queda «pendiente de pago» y reserva el cupo
 * HORAS_RESERVA horas; si no se reporta el pago a tiempo vence y el cupo vuelve a la tienda.
 */
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const almacen = require('./almacen');

const fotos = almacen.crearAlmacen({ bucket: process.env.SUPABASE_BUCKET_TIENDA || 'tienda', carpetaDisco: path.join(__dirname, 'uploads', 'tienda') });

const HORAS_RESERVA = Number(process.env.TIENDA_HORAS_RESERVA) || 48;
const METODOS_PAGO = { pago_movil: 'Pago Móvil', zelle: 'Zelle', transferencia: 'Transferencia bancaria', binance: 'Binance (USDT)', efectivo: 'Efectivo en Valencia' };
const ESTADOS = {
  pendiente_pago: 'Pendiente de pago',
  pago_reportado: 'Pago reportado',
  pagado: 'Pagado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  vencido: 'Vencido',
};
/** Estados que liberan el cupo reservado (al pasar a ellos se devuelven las unidades). */
const LIBERAN_CUPO = ['cancelado', 'vencido'];
/** Transiciones que el panel puede hacer. */
const SIGUIENTES = {
  pendiente_pago: ['pago_reportado', 'pagado', 'cancelado'],
  pago_reportado: ['pagado', 'pendiente_pago', 'cancelado'],
  pagado: ['en_camino', 'cancelado'],
  en_camino: ['entregado'],
  entregado: [],
  cancelado: [],
  vencido: [],
};

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v == null || v === '' ? 0 : Number(v));
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const fechaISO = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
/** Fecha y hora UTC como 'YYYY-MM-DD HH:MM:SS': la entienden Postgres y SQLite, y en SQLite se compara bien con CURRENT_TIMESTAMP. */
const marcaUTC = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
/** Para responder: siempre ISO con zona (Postgres entrega Date; SQLite, texto en UTC sin zona). */
const instanteISO = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const listaJSON = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };
const slugDe = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function tipoImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

async function ensureSchema(db) {
  await db.query('CREATE TABLE IF NOT EXISTS tienda_categorias (id SERIAL PRIMARY KEY, nombre VARCHAR(80) NOT NULL, slug VARCHAR(80) NOT NULL UNIQUE, orden INTEGER NOT NULL DEFAULT 0, activa BOOLEAN NOT NULL DEFAULT TRUE)');
  await db.query(`CREATE TABLE IF NOT EXISTS tienda_productos (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(90) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    categoria_id INTEGER,
    origen VARCHAR(120),
    descripcion TEXT,
    especificaciones TEXT,
    precio_usd NUMERIC(10,2) NOT NULL,
    precio_antes_usd NUMERIC(10,2),
    nombre_variante VARCHAR(40) NOT NULL DEFAULT 'Presentación',
    contenedor_id INTEGER,
    orden INTEGER NOT NULL DEFAULT 0,
    activo BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS tienda_variantes (
    id SERIAL PRIMARY KEY,
    producto_id INTEGER NOT NULL,
    nombre VARCHAR(80) NOT NULL,
    sku VARCHAR(60),
    cupo INTEGER NOT NULL DEFAULT 0,
    precio_usd NUMERIC(10,2),
    orden INTEGER NOT NULL DEFAULT 0,
    activa BOOLEAN NOT NULL DEFAULT TRUE)`);
  await db.query('CREATE INDEX IF NOT EXISTS tienda_variantes_producto_idx ON tienda_variantes(producto_id)');
  // De dónde salió el producto (importador-1688.js) y su costo de referencia en yuanes: solo los ve el panel.
  await db.query('ALTER TABLE tienda_productos ADD COLUMN IF NOT EXISTS fuente_url TEXT');
  await db.query('ALTER TABLE tienda_productos ADD COLUMN IF NOT EXISTS costo_referencia TEXT');
  await db.query('CREATE TABLE IF NOT EXISTS tienda_imagenes (id SERIAL PRIMARY KEY, producto_id INTEGER NOT NULL, nombre_guardado VARCHAR(255) NOT NULL, mime_type VARCHAR(60) NOT NULL, almacen VARCHAR(10) NOT NULL DEFAULT \'disco\', orden INTEGER NOT NULL DEFAULT 0)');
  await db.query('CREATE INDEX IF NOT EXISTS tienda_imagenes_producto_idx ON tienda_imagenes(producto_id)');
  await db.query('CREATE TABLE IF NOT EXISTS tienda_destinos (id SERIAL PRIMARY KEY, nombre VARCHAR(80) NOT NULL, costo_usd NUMERIC(10,2) NOT NULL DEFAULT 0, dias_extra INTEGER NOT NULL DEFAULT 0, requiere_direccion BOOLEAN NOT NULL DEFAULT TRUE, orden INTEGER NOT NULL DEFAULT 0, activo BOOLEAN NOT NULL DEFAULT TRUE)');
  await db.query(`CREATE TABLE IF NOT EXISTS tienda_pedidos (
    id SERIAL PRIMARY KEY,
    numero VARCHAR(20) UNIQUE,
    token_hash VARCHAR(64) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(50) NOT NULL,
    email VARCHAR(150),
    cedula VARCHAR(30),
    destino_id INTEGER,
    destino VARCHAR(80),
    direccion TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente_pago',
    subtotal_usd NUMERIC(10,2) NOT NULL,
    envio_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_usd NUMERIC(10,2) NOT NULL,
    metodo_pago VARCHAR(20),
    referencia_pago VARCHAR(120),
    pago_reportado_en TIMESTAMP,
    vence_en TIMESTAMP,
    cliente_id INTEGER,
    notas TEXT,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query('CREATE INDEX IF NOT EXISTS tienda_pedidos_estado_idx ON tienda_pedidos(estado, vence_en)');
  await db.query('CREATE TABLE IF NOT EXISTS tienda_pedido_items (id SERIAL PRIMARY KEY, pedido_id INTEGER NOT NULL, producto_id INTEGER, variante_id INTEGER, nombre VARCHAR(150) NOT NULL, variante VARCHAR(80), precio_usd NUMERIC(10,2) NOT NULL, cantidad INTEGER NOT NULL, contenedor_id INTEGER)');
  await db.query('CREATE INDEX IF NOT EXISTS tienda_pedido_items_pedido_idx ON tienda_pedido_items(pedido_id)');

  // Destinos del diseño, solo si la tabla está vacía (el panel los ajusta después).
  const hay = await db.query('SELECT COUNT(*) AS n FROM tienda_destinos');
  if (!num(hay.rows[0]?.n)) {
    for (const [i, d] of [['Retiro en Valencia', 0, 0, false], ['Caracas', 6, 3, true], ['Maracaibo', 12, 5, true]].entries()) {
      await db.query('INSERT INTO tienda_destinos(nombre,costo_usd,dias_extra,requiere_direccion,orden) VALUES($1,$2,$3,$4,$5)', [d[0], d[1], d[2], d[3], i]);
    }
  }
}

/** Devuelve el cupo de un pedido a sus variantes (al cancelar o vencer). */
async function devolverCupo(q, pedidoId) {
  const items = (await q.query('SELECT variante_id,cantidad FROM tienda_pedido_items WHERE pedido_id=$1', [pedidoId])).rows;
  for (const it of items) if (it.variante_id) await q.query('UPDATE tienda_variantes SET cupo = cupo + $1 WHERE id=$2', [num(it.cantidad), it.variante_id]);
}

function registrar(app, { db, auth, intId, logAction }) {
  const limitePedidos = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados pedidos seguidos. Intenta de nuevo en unos minutos.' } });
  const limiteConsulta = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas. Espera un minuto.' } });
  const subir = multer({ storage: multer.memoryStorage(), limits: { files: 8, fileSize: 6 * 1024 * 1024 } });
  const soloAdmin = (req, res) => {
    if (req.user.rol === 'admin') return true;
    res.status(403).json({ error: 'Solo el administrador' });
    return false;
  };

  // Vencimiento perezoso de reservas: sin tareas programadas (Vercel), se revisa al leer o escribir la tienda.
  let ultimaRevision = 0;
  async function vencerReservas() {
    if (Date.now() - ultimaRevision < 60 * 1000) return;
    ultimaRevision = Date.now();
    const vencidos = (await db.query("SELECT id FROM tienda_pedidos WHERE estado='pendiente_pago' AND vence_en < CURRENT_TIMESTAMP")).rows;
    for (const p of vencidos) {
      const r = await db.query("UPDATE tienda_pedidos SET estado='vencido', actualizado_en=CURRENT_TIMESTAMP WHERE id=$1 AND estado='pendiente_pago'", [p.id]);
      if (r.rowCount) await devolverCupo(db, p.id);
    }
  }

  const urlImagen = (id) => `/api/tienda/imagenes/${id}`;

  /** Tarjetas de producto con su contenedor, primera foto y si quedan unidades. */
  async function tarjetas(where, params) {
    const productos = (await db.query(
      `SELECT p.*, c.nombre AS categoria, c.slug AS categoria_slug, k.numero AS contenedor, k.fecha_estimada AS llegada
       FROM tienda_productos p LEFT JOIN tienda_categorias c ON c.id=p.categoria_id LEFT JOIN contenedores k ON k.id=p.contenedor_id
       WHERE ${where} ORDER BY p.orden, p.id`, params)).rows;
    if (!productos.length) return [];
    const ids = productos.map((p) => Number(p.id));
    // Variantes con cupo, en orden: la primera es la que agrega el botón rápido «Agregar al carrito» de la tarjeta.
    const variantes = (await db.query('SELECT id, producto_id, nombre, precio_usd FROM tienda_variantes WHERE producto_id = ANY($1::int[]) AND activa = TRUE AND cupo > 0 ORDER BY orden, id', [ids])).rows;
    const imagenes = (await db.query('SELECT id, producto_id FROM tienda_imagenes WHERE producto_id = ANY($1::int[]) ORDER BY orden, id', [ids])).rows;
    const primera = new Map();
    variantes.forEach((v) => { if (!primera.has(Number(v.producto_id))) primera.set(Number(v.producto_id), v); });
    const foto = new Map();
    imagenes.forEach((i) => { if (!foto.has(Number(i.producto_id))) foto.set(Number(i.producto_id), urlImagen(i.id)); });
    return productos.map((p) => {
      const v = primera.get(Number(p.id));
      return {
        id: String(p.id),
        slug: p.slug,
        nombre: p.nombre,
        categoria: p.categoria || '',
        categoriaSlug: p.categoria_slug || '',
        precioUsd: num(p.precio_usd),
        precioAntesUsd: p.precio_antes_usd != null ? num(p.precio_antes_usd) : null,
        imagen: foto.get(Number(p.id)) || null,
        contenedor: p.contenedor || null,
        llegada: fechaISO(p.llegada),
        agotado: !v,
        varianteRapida: v ? { id: String(v.id), nombre: v.nombre, precioUsd: v.precio_usd != null ? num(v.precio_usd) : num(p.precio_usd) } : null,
      };
    });
  }

  app.get('/api/tienda/catalogo', async (req, res) => {
    try {
      await vencerReservas();
      const categorias = (await db.query('SELECT c.nombre, c.slug, COUNT(p.id) AS total FROM tienda_categorias c LEFT JOIN tienda_productos p ON p.categoria_id=c.id AND p.activo = TRUE WHERE c.activa = TRUE GROUP BY c.id, c.nombre, c.slug, c.orden ORDER BY c.orden, c.nombre')).rows;
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json({
        categorias: categorias.map((c) => ({ nombre: c.nombre, slug: c.slug, total: num(c.total) })),
        productos: await tarjetas('p.activo = TRUE', []),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la tienda' });
    }
  });

  app.get('/api/tienda/productos/:slug', async (req, res) => {
    try {
      await vencerReservas();
      const [p] = await tarjetas('p.activo = TRUE AND p.slug = $1', [texto(req.params.slug, 90)]);
      if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
      const fila = (await db.query('SELECT origen, descripcion, especificaciones, nombre_variante, contenedor_id FROM tienda_productos WHERE id=$1', [intId(p.id)])).rows[0];
      const variantes = (await db.query('SELECT id,nombre,cupo,precio_usd FROM tienda_variantes WHERE producto_id=$1 AND activa = TRUE ORDER BY orden, id', [intId(p.id)])).rows;
      const imagenes = (await db.query('SELECT id FROM tienda_imagenes WHERE producto_id=$1 ORDER BY orden, id', [intId(p.id)])).rows;
      const mismo = fila.contenedor_id ? (await tarjetas('p.activo = TRUE AND p.contenedor_id = $1 AND p.id <> $2', [fila.contenedor_id, intId(p.id)])).slice(0, 4) : [];
      res.setHeader('Cache-Control', 'public, max-age=30');
      res.json({
        ...p,
        origen: fila.origen || '',
        descripcion: listaJSON(fila.descripcion),
        especificaciones: listaJSON(fila.especificaciones),
        nombreVariante: fila.nombre_variante,
        // Solo «disponible» o no: el cupo exacto es información del negocio.
        variantes: variantes.map((v) => ({ id: String(v.id), nombre: v.nombre, disponible: num(v.cupo) > 0, precioUsd: v.precio_usd != null ? num(v.precio_usd) : p.precioUsd })),
        imagenes: imagenes.map((i) => urlImagen(i.id)),
        mismoContenedor: mismo,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar el producto' });
    }
  });

  app.get('/api/tienda/destinos', async (req, res) => {
    try {
      const r = await db.query('SELECT id,nombre,costo_usd,dias_extra,requiere_direccion FROM tienda_destinos WHERE activo = TRUE ORDER BY orden, id');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(r.rows.map((d) => ({ id: String(d.id), nombre: d.nombre, costoUsd: num(d.costo_usd), diasExtra: num(d.dias_extra), requiereDireccion: !!d.requiere_direccion })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar los destinos' });
    }
  });

  app.get('/api/tienda/imagenes/:id', async (req, res) => {
    try {
      const i = (await db.query('SELECT i.nombre_guardado,i.mime_type,i.almacen FROM tienda_imagenes i JOIN tienda_productos p ON p.id=i.producto_id WHERE i.id=$1 AND p.activo = TRUE', [intId(req.params.id)])).rows[0];
      if (!i) return res.status(404).json({ error: 'Imagen no encontrada' });
      const contenido = await fotos.leer(i.almacen, i.nombre_guardado);
      if (!contenido) return res.status(404).json({ error: 'Imagen no encontrada' });
      res.setHeader('Content-Type', i.mime_type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      // La web pública vive en otro dominio: sin esto, helmet (same-origin) hace que el navegador bloquee la foto.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.send(contenido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la imagen' });
    }
  });

  app.post('/api/tienda/pedidos', limitePedidos, async (req, res) => {
    let tx;
    try {
      await vencerReservas();
      const b = req.body || {};
      const nombre = texto(b.cliente?.nombre, 150);
      const telefono = texto(b.cliente?.telefono, 50).replace(/[^\d+\-\s()]/g, '');
      const email = texto(b.cliente?.email, 150).toLowerCase();
      const cedula = texto(b.cliente?.cedula, 30).toUpperCase();
      const metodo = Object.hasOwn(METODOS_PAGO, b.metodoPago) ? b.metodoPago : null;
      if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre' });
      if (telefono.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Escribe un teléfono de contacto (WhatsApp)' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'El correo no es válido' });
      if (!metodo) return res.status(400).json({ error: 'Elige cómo vas a pagar' });

      const destino = (await db.query('SELECT id,nombre,costo_usd,requiere_direccion FROM tienda_destinos WHERE id=$1 AND activo = TRUE', [intId(b.destinoId)])).rows[0];
      if (!destino) return res.status(400).json({ error: 'Elige dónde recibes tu pedido' });
      const direccion = texto(b.direccion, 500);
      if (destino.requiere_direccion && direccion.length < 8) return res.status(400).json({ error: 'Escribe la dirección de entrega' });

      // Se agrupan las líneas por variante; el navegador no decide precios.
      const pedidas = new Map();
      for (const it of Array.isArray(b.items) ? b.items.slice(0, 30) : []) {
        const v = intId(it?.varianteId);
        const q = Math.trunc(Number(it?.cantidad));
        if (!v || !(q > 0 && q <= 50)) return res.status(400).json({ error: 'Cantidad no válida en el carrito' });
        pedidas.set(v, (pedidas.get(v) || 0) + q);
      }
      if (!pedidas.size) return res.status(400).json({ error: 'Tu carrito está vacío' });

      tx = await db.connect();
      await tx.query('BEGIN');
      const lineas = [];
      for (const [varianteId, cantidad] of pedidas) {
        const v = (await tx.query(
          `SELECT v.id, v.nombre AS variante, v.precio_usd AS precio_variante, p.id AS producto_id, p.nombre, p.precio_usd, p.contenedor_id
           FROM tienda_variantes v JOIN tienda_productos p ON p.id=v.producto_id WHERE v.id=$1 AND v.activa = TRUE AND p.activo = TRUE`, [varianteId])).rows[0];
        if (!v) { await tx.query('ROLLBACK'); return res.status(409).json({ error: 'Un producto del carrito ya no está disponible. Actualiza el carrito.' }); }
        // Reserva atómica: solo descuenta si queda cupo suficiente (dos compras a la vez no pueden pasarse del cupo).
        const r = await tx.query('UPDATE tienda_variantes SET cupo = cupo - $1 WHERE id=$2 AND cupo >= $1', [cantidad, varianteId]);
        if (!r.rowCount) { await tx.query('ROLLBACK'); return res.status(409).json({ error: `No queda cupo suficiente de «${v.nombre} · ${v.variante}» en este contenedor.` }); }
        lineas.push({ ...v, cantidad, precio: num(v.precio_variante ?? v.precio_usd) });
      }
      const subtotal = r2(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0));
      const envio = r2(num(destino.costo_usd));
      const token = crypto.randomBytes(18).toString('base64url');
      const vence = new Date(Date.now() + HORAS_RESERVA * 3600 * 1000);
      const ins = await tx.query(
        `INSERT INTO tienda_pedidos(token_hash,nombre,telefono,email,cedula,destino_id,destino,direccion,subtotal_usd,envio_usd,total_usd,metodo_pago,vence_en)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [hash(token), nombre, telefono, email || null, cedula || null, destino.id, destino.nombre, direccion || null, subtotal, envio, r2(subtotal + envio), metodo, marcaUTC(vence)]
      );
      const pedidoId = Number(ins.rows[0].id);
      const numero = `PED-${String(pedidoId).padStart(6, '0')}`;
      await tx.query('UPDATE tienda_pedidos SET numero=$1 WHERE id=$2', [numero, pedidoId]);
      for (const l of lineas) {
        await tx.query('INSERT INTO tienda_pedido_items(pedido_id,producto_id,variante_id,nombre,variante,precio_usd,cantidad,contenedor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [pedidoId, l.producto_id, l.id, l.nombre, l.variante, l.precio, l.cantidad, l.contenedor_id || null]);
      }
      await tx.query('COMMIT');
      res.status(201).json({
        numero,
        token, // se muestra una sola vez: con él el cliente consulta su pedido y reporta el pago
        totalUsd: r2(subtotal + envio),
        venceEn: vence.toISOString(),
        metodoPago: METODOS_PAGO[metodo],
        instrucciones: process.env.TIENDA_INSTRUCCIONES_PAGO || 'Tu asesora te escribirá por WhatsApp con los datos de pago.',
      });
    } catch (e) {
      if (tx) await tx.query('ROLLBACK').catch(() => {});
      console.error(e);
      res.status(500).json({ error: 'No se pudo crear el pedido' });
    } finally {
      tx?.release?.();
    }
  });

  async function pedidoConToken(req, res) {
    const p = (await db.query('SELECT * FROM tienda_pedidos WHERE numero=$1', [texto(req.params.numero, 20).toUpperCase()])).rows[0];
    const token = String(req.headers['x-pedido-token'] || '');
    // Misma respuesta si no existe o si el token no coincide: no se revela qué números existen.
    if (!p || !token || !crypto.timingSafeEqual(Buffer.from(hash(token)), Buffer.from(p.token_hash))) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return null;
    }
    return p;
  }

  const pedidoPublico = async (p) => ({
    numero: p.numero,
    estado: p.estado,
    estadoTexto: ESTADOS[p.estado] || p.estado,
    destino: p.destino,
    subtotalUsd: num(p.subtotal_usd),
    envioUsd: num(p.envio_usd),
    totalUsd: num(p.total_usd),
    metodoPago: METODOS_PAGO[p.metodo_pago] || p.metodo_pago,
    pagoReportado: !!p.referencia_pago,
    venceEn: p.estado === 'pendiente_pago' ? instanteISO(p.vence_en) : null,
    items: (await db.query('SELECT i.nombre,i.variante,i.precio_usd,i.cantidad,k.numero AS contenedor,k.fecha_estimada FROM tienda_pedido_items i LEFT JOIN contenedores k ON k.id=i.contenedor_id WHERE i.pedido_id=$1 ORDER BY i.id', [p.id])).rows
      .map((i) => ({ nombre: i.nombre, variante: i.variante, precioUsd: num(i.precio_usd), cantidad: num(i.cantidad), contenedor: i.contenedor || null, llegada: fechaISO(i.fecha_estimada) })),
  });

  app.get('/api/tienda/pedidos/:numero', limiteConsulta, async (req, res) => {
    try {
      await vencerReservas();
      const p = await pedidoConToken(req, res);
      if (!p) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await pedidoPublico(p));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo consultar el pedido' });
    }
  });

  app.post('/api/tienda/pedidos/:numero/pago', limitePedidos, async (req, res) => {
    try {
      const p = await pedidoConToken(req, res);
      if (!p) return;
      const referencia = texto(req.body?.referencia, 120);
      if (referencia.length < 4) return res.status(400).json({ error: 'Escribe la referencia o el número de la operación' });
      if (!['pendiente_pago', 'pago_reportado'].includes(p.estado)) return res.status(409).json({ error: `El pedido está ${String(ESTADOS[p.estado] || p.estado).toLowerCase()}.` });
      await db.query("UPDATE tienda_pedidos SET estado='pago_reportado', referencia_pago=$1, pago_reportado_en=CURRENT_TIMESTAMP, actualizado_en=CURRENT_TIMESTAMP WHERE id=$2", [referencia, p.id]);
      res.json({ ok: true, estado: 'pago_reportado', estadoTexto: ESTADOS.pago_reportado });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo reportar el pago' });
    }
  });

  /* ----- panel (administrador) ----- */

  app.get('/api/tienda/admin/productos', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const productos = (await db.query('SELECT p.*, k.numero AS contenedor FROM tienda_productos p LEFT JOIN contenedores k ON k.id=p.contenedor_id ORDER BY p.orden, p.id')).rows;
      const variantes = (await db.query('SELECT * FROM tienda_variantes ORDER BY orden, id')).rows;
      const imagenes = (await db.query('SELECT id, producto_id FROM tienda_imagenes ORDER BY orden, id')).rows;
      res.json(productos.map((p) => ({
        id: String(p.id), slug: p.slug, nombre: p.nombre, categoriaId: p.categoria_id ? String(p.categoria_id) : '', origen: p.origen || '',
        descripcion: listaJSON(p.descripcion), especificaciones: listaJSON(p.especificaciones),
        precioUsd: num(p.precio_usd), precioAntesUsd: p.precio_antes_usd != null ? num(p.precio_antes_usd) : null, nombreVariante: p.nombre_variante,
        contenedorId: p.contenedor_id ? String(p.contenedor_id) : '', contenedor: p.contenedor || '', orden: num(p.orden), activo: !!p.activo,
        fuenteUrl: p.fuente_url || '', costoReferencia: (() => { try { return p.costo_referencia ? JSON.parse(p.costo_referencia) : null; } catch { return null; } })(),
        variantes: variantes.filter((v) => v.producto_id === p.id).map((v) => ({ id: String(v.id), nombre: v.nombre, sku: v.sku || '', cupo: num(v.cupo), precioUsd: v.precio_usd != null ? num(v.precio_usd) : null, activa: !!v.activa })),
        imagenes: imagenes.filter((i) => i.producto_id === p.id).map((i) => ({ id: String(i.id), url: `/api/tienda/admin/imagenes/${i.id}` })),
      })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar los productos' });
    }
  });

  /**
   * Crea (sin id) o actualiza un producto con sus variantes. Las variantes que no vengan en la lista se desactivan.
   * Devuelve { status, body } para que la usen tanto la ruta de un producto como la carga masiva.
   */
  async function persistirProducto(b, id, usuarioId) {
    const fallo = (status, error) => ({ status, body: { error } });
    const nombre = texto(b.nombre, 150);
    const precio = Number(b.precioUsd);
    const antes = b.precioAntesUsd == null || b.precioAntesUsd === '' ? null : Number(b.precioAntesUsd);
    if (!nombre) return fallo(400, 'El nombre es obligatorio');
    if (!(precio > 0)) return fallo(400, 'El precio debe ser mayor que cero');
    if (antes != null && !(antes > precio)) return fallo(400, 'El precio anterior debe ser mayor que el actual');
    const variantes = Array.isArray(b.variantes) ? b.variantes.slice(0, 20) : [];
    if (!variantes.length) return fallo(400, 'Agrega al menos una variante (aunque sea única)');
    for (const v of variantes) {
      if (!texto(v?.nombre, 80)) return fallo(400, 'Cada variante necesita un nombre');
      if (!(Number.isInteger(Number(v?.cupo)) && Number(v.cupo) >= 0)) return fallo(400, 'El cupo de cada variante debe ser un número entero');
    }
    const slug = slugDe(b.slug || nombre) || `producto-${Date.now()}`;
    const lista = (v) => JSON.stringify((Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => texto(x, 500)).filter(Boolean).slice(0, 20));
    const valores = [slug, nombre, intId(b.categoriaId), texto(b.origen, 120) || null, lista(b.descripcion), lista(b.especificaciones), precio, antes, texto(b.nombreVariante, 40) || 'Presentación', intId(b.contenedorId), Math.trunc(num(b.orden)), !!b.activo];

    const nuevo = !id;
    const tx = await db.connect();
    try {
      await tx.query('BEGIN');
      const repetido = (await tx.query('SELECT id FROM tienda_productos WHERE slug=$1', [slug])).rows[0];
      if (repetido && Number(repetido.id) !== id) { await tx.query('ROLLBACK'); return fallo(409, 'Ya hay un producto con esa dirección (slug). Cambia el nombre o el slug.'); }
      if (id) {
        const r = await tx.query('UPDATE tienda_productos SET slug=$1,nombre=$2,categoria_id=$3,origen=$4,descripcion=$5,especificaciones=$6,precio_usd=$7,precio_antes_usd=$8,nombre_variante=$9,contenedor_id=$10,orden=$11,activo=$12,actualizado_en=CURRENT_TIMESTAMP WHERE id=$13', [...valores, id]);
        if (!r.rowCount) { await tx.query('ROLLBACK'); return fallo(404, 'Producto no encontrado'); }
      } else {
        id = Number((await tx.query('INSERT INTO tienda_productos(slug,nombre,categoria_id,origen,descripcion,especificaciones,precio_usd,precio_antes_usd,nombre_variante,contenedor_id,orden,activo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id', valores)).rows[0].id);
      }
      const existentes = (await tx.query('SELECT id FROM tienda_variantes WHERE producto_id=$1', [id])).rows.map((v) => Number(v.id));
      const vistas = new Set();
      for (const [i, v] of variantes.entries()) {
        const vid = intId(v.id);
        const fila = [texto(v.nombre, 80), texto(v.sku, 60) || null, Math.trunc(Number(v.cupo)), v.precioUsd == null || v.precioUsd === '' ? null : Number(v.precioUsd), i, v.activa !== false];
        if (vid && existentes.includes(vid)) {
          await tx.query('UPDATE tienda_variantes SET nombre=$1,sku=$2,cupo=$3,precio_usd=$4,orden=$5,activa=$6 WHERE id=$7', [...fila, vid]);
          vistas.add(vid);
        } else {
          await tx.query('INSERT INTO tienda_variantes(nombre,sku,cupo,precio_usd,orden,activa,producto_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [...fila, id]);
        }
      }
      // No se borran: pueden estar en pedidos ya hechos.
      for (const vid of existentes) if (!vistas.has(vid)) await tx.query('UPDATE tienda_variantes SET activa = FALSE WHERE id=$1', [vid]);
      await tx.query('COMMIT');
      // Origen y costo de referencia (solo los manda el importador; editar en el panel no los borra). Van aparte y
      // después del COMMIT: si falta la migración 20261104000000_tienda_importador.sql, el producto se guarda igual.
      let aviso = null;
      if (b.fuenteUrl !== undefined || b.costoReferencia !== undefined) {
        const fuente = /^https?:\/\//.test(texto(b.fuenteUrl, 600)) ? texto(b.fuenteUrl, 600) : null;
        try {
          await db.query('UPDATE tienda_productos SET fuente_url=$1, costo_referencia=$2 WHERE id=$3', [fuente, b.costoReferencia ? JSON.stringify(b.costoReferencia).slice(0, 4000) : null, id]);
        } catch (e) {
          console.error('Origen del producto no guardado (¿falta la migración 20261104000000_tienda_importador.sql?):', e.message);
          aviso = 'El producto se guardó, pero no su enlace de origen ni su costo: falta aplicar la migración 20261104000000_tienda_importador.sql en Supabase.';
        }
      }
      await logAction(usuarioId, `Producto de la tienda: ${nombre}`, 'tienda_productos', id, b.activo ? 'Publicado.' : 'Guardado sin publicar.');
      return { status: nuevo ? 201 : 200, body: { ok: true, id: String(id), slug, ...(aviso ? { aviso } : {}) } };
    } catch (e) {
      await tx.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      tx.release?.();
    }
  }

  async function guardarProducto(req, res, id) {
    const r = await persistirProducto(req.body || {}, id, req.user.id);
    res.status(r.status).json(r.body);
  }

  /**
   * Edición en lote (va antes de «/:id» para que «lote» no se tome como un id). Aplica a varios productos a la vez,
   * en una sola transacción, solo los cambios que vengan:
   *   { ids: [...], cambios: { contenedorId?, categoriaId?, cupo?, precioPct?, activo? } }
   * `cupo` se pone a cada variante activa; `precioPct` sube o baja el precio (y el de las variantes) en ese porcentaje.
   */
  app.put('/api/tienda/admin/productos/lote', auth, async (req, res) => {
    if (!soloAdmin(req, res)) return;
    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(intId).filter(Boolean))].slice(0, 500);
    const c = req.body?.cambios || {};
    if (!ids.length) return res.status(400).json({ error: 'Selecciona al menos un producto' });
    const tiene = (k) => Object.prototype.hasOwnProperty.call(c, k) && c[k] !== undefined;
    if (!['contenedorId', 'categoriaId', 'cupo', 'precioPct', 'activo'].some(tiene)) return res.status(400).json({ error: 'No hay cambios que aplicar' });
    if (tiene('cupo') && !(Number.isInteger(Number(c.cupo)) && Number(c.cupo) >= 0 && Number(c.cupo) <= 1000000)) return res.status(400).json({ error: 'El cupo debe ser un número entero, 0 o mayor' });
    const pct = tiene('precioPct') ? Number(c.precioPct) : 0;
    if (tiene('precioPct') && !(Number.isFinite(pct) && pct > -90 && pct <= 500 && pct !== 0)) return res.status(400).json({ error: 'El ajuste de precio debe estar entre −90 % y 500 % (y no ser 0)' });

    const tx = await db.connect();
    try {
      await tx.query('BEGIN');
      const existentes = (await tx.query('SELECT id, precio_usd, precio_antes_usd FROM tienda_productos WHERE id = ANY($1::int[])', [ids])).rows;
      if (existentes.length !== ids.length) { await tx.query('ROLLBACK'); return res.status(404).json({ error: 'Algún producto ya no existe: recarga la lista' }); }
      if (tiene('contenedorId')) {
        const k = intId(c.contenedorId);
        if (k && !(await tx.query('SELECT id FROM contenedores WHERE id=$1', [k])).rows.length) { await tx.query('ROLLBACK'); return res.status(400).json({ error: 'El contenedor no existe' }); }
        await tx.query('UPDATE tienda_productos SET contenedor_id=$1, actualizado_en=CURRENT_TIMESTAMP WHERE id = ANY($2::int[])', [k, ids]);
      }
      if (tiene('categoriaId')) {
        const k = intId(c.categoriaId);
        if (k && !(await tx.query('SELECT id FROM tienda_categorias WHERE id=$1', [k])).rows.length) { await tx.query('ROLLBACK'); return res.status(400).json({ error: 'La categoría no existe' }); }
        await tx.query('UPDATE tienda_productos SET categoria_id=$1, actualizado_en=CURRENT_TIMESTAMP WHERE id = ANY($2::int[])', [k, ids]);
      }
      if (tiene('cupo')) await tx.query('UPDATE tienda_variantes SET cupo=$1 WHERE activa = TRUE AND producto_id = ANY($2::int[])', [Math.trunc(Number(c.cupo)), ids]);
      if (pct) {
        const f = 1 + pct / 100;
        for (const p of existentes) {
          const nuevo = Math.max(0.01, Math.round(num(p.precio_usd) * f * 100) / 100);
          // El precio anterior (tachado) solo sigue si aún es mayor que el nuevo.
          const antes = p.precio_antes_usd != null && num(p.precio_antes_usd) > nuevo ? num(p.precio_antes_usd) : null;
          await tx.query('UPDATE tienda_productos SET precio_usd=$1, precio_antes_usd=$2, actualizado_en=CURRENT_TIMESTAMP WHERE id=$3', [nuevo, antes, p.id]);
        }
        const vars = (await tx.query('SELECT id, precio_usd FROM tienda_variantes WHERE precio_usd IS NOT NULL AND producto_id = ANY($1::int[])', [ids])).rows;
        for (const v of vars) await tx.query('UPDATE tienda_variantes SET precio_usd=$1 WHERE id=$2', [Math.max(0.01, Math.round(num(v.precio_usd) * f * 100) / 100), v.id]);
      }
      if (tiene('activo')) await tx.query('UPDATE tienda_productos SET activo=$1, actualizado_en=CURRENT_TIMESTAMP WHERE id = ANY($2::int[])', [!!c.activo, ids]);
      await tx.query('COMMIT');
    } catch (e) {
      await tx.query('ROLLBACK').catch(() => {});
      console.error(e);
      return res.status(500).json({ error: 'No se pudieron aplicar los cambios' });
    } finally {
      tx.release?.();
    }

    // Lo que conviene revisar entre los publicados: sin contenedor (sin fecha de llegada) o sin cupo (salen agotados).
    const estado = (await db.query(`SELECT p.id, p.activo, p.contenedor_id,
        (SELECT COALESCE(SUM(v.cupo),0) FROM tienda_variantes v WHERE v.producto_id=p.id AND v.activa = TRUE) AS cupo
      FROM tienda_productos p WHERE p.id = ANY($1::int[])`, [ids])).rows.filter((p) => p.activo);
    const partes = [tiene('contenedorId') && 'contenedor', tiene('categoriaId') && 'categoría', tiene('cupo') && `cupo ${c.cupo}`, pct && `precio ${pct > 0 ? '+' : ''}${pct} %`, tiene('activo') && (c.activo ? 'publicados' : 'ocultos')].filter(Boolean);
    await logAction(req.user.id, `Tienda: ${ids.length} producto(s) editados en lote`, 'tienda_productos', null, partes.join(' · '));
    res.json({ ok: true, actualizados: ids.length, publicadosSinContenedor: estado.filter((p) => !p.contenedor_id).length, publicadosSinCupo: estado.filter((p) => !(num(p.cupo) > 0)).length });
  });

  app.post('/api/tienda/admin/productos', auth, async (req, res) => {
    try { if (soloAdmin(req, res)) await guardarProducto(req, res, null); } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar el producto' }); }
  });
  app.put('/api/tienda/admin/productos/:id', auth, async (req, res) => {
    try { if (soloAdmin(req, res)) await guardarProducto(req, res, intId(req.params.id)); } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar el producto' }); }
  });

  /**
   * Trae las fotos del proveedor desde sus enlaces (los que encontró el importador). Solo de dominios de mercados
   * chinos, por HTTPS, con tope de tamaño y validando los bytes: el servidor no descarga cualquier dirección.
   */
  const DOMINIOS_FOTOS = ['alicdn.com', '1688.com', 'taobao.com', 'tmall.com', 'yiwugo.com', 'tbcdn.cn', 'alibaba.com'];
  app.post('/api/tienda/admin/productos/:id/imagenes-remotas', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const id = intId(req.params.id);
      if (!(await db.query('SELECT id FROM tienda_productos WHERE id=$1', [id])).rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
      const urls = (Array.isArray(req.body?.urls) ? req.body.urls : []).map((u) => texto(u, 600)).slice(0, 8);
      let orden = num((await db.query('SELECT COUNT(*) AS n FROM tienda_imagenes WHERE producto_id=$1', [id])).rows[0]?.n);
      let guardadas = 0;
      for (const u of urls) {
        let destino;
        try { destino = new URL(u); } catch { continue; }
        if (destino.protocol !== 'https:' || !DOMINIOS_FOTOS.some((d) => destino.hostname === d || destino.hostname.endsWith('.' + d))) continue;
        try {
          const r = await fetch(destino, { redirect: 'error', signal: AbortSignal.timeout(10000) });
          if (!r.ok || Number(r.headers.get('content-length') || 0) > 6 * 1024 * 1024) continue;
          const buf = Buffer.from(await r.arrayBuffer());
          const t = buf.length <= 6 * 1024 * 1024 ? tipoImagen(buf) : null;
          if (!t) continue;
          const g = await fotos.guardar(`p${id}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${t.ext}`, buf, t.mime);
          await db.query('INSERT INTO tienda_imagenes(producto_id,nombre_guardado,mime_type,almacen,orden) VALUES($1,$2,$3,$4,$5)', [id, g.clave, t.mime, g.almacen, orden++]);
          guardadas++;
        } catch { /* una foto que no baja no detiene las demás */ }
      }
      res.json({ ok: true, guardadas, pedidas: urls.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron traer las fotos' });
    }
  });

  app.post('/api/tienda/admin/productos/:id/imagenes', auth, (req, res, next) => subir.array('imagenes', 8)(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada foto debe pesar menos de 6 MB' : 'No se pudieron recibir las fotos' }) : next())), async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const id = intId(req.params.id);
      if (!(await db.query('SELECT id FROM tienda_productos WHERE id=$1', [id])).rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
      let orden = num((await db.query('SELECT COUNT(*) AS n FROM tienda_imagenes WHERE producto_id=$1', [id])).rows[0]?.n);
      let guardadas = 0;
      for (const f of req.files || []) {
        const t = tipoImagen(f.buffer); // por los bytes, no por el nombre
        if (!t) continue;
        const g = await fotos.guardar(`p${id}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${t.ext}`, f.buffer, t.mime);
        await db.query('INSERT INTO tienda_imagenes(producto_id,nombre_guardado,mime_type,almacen,orden) VALUES($1,$2,$3,$4,$5)', [id, g.clave, t.mime, g.almacen, orden++]);
        guardadas++;
      }
      if (!guardadas) return res.status(400).json({ error: 'Sube fotos JPG, PNG o WEBP' });
      res.status(201).json({ ok: true, guardadas });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron guardar las fotos' });
    }
  });

  /** El panel ve también las fotos de productos sin publicar. */
  app.get('/api/tienda/admin/imagenes/:id', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const i = (await db.query('SELECT nombre_guardado,mime_type,almacen FROM tienda_imagenes WHERE id=$1', [intId(req.params.id)])).rows[0];
      const contenido = i && (await fotos.leer(i.almacen, i.nombre_guardado));
      if (!contenido) return res.status(404).json({ error: 'Imagen no encontrada' });
      res.setHeader('Content-Type', i.mime_type);
      res.send(contenido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la imagen' });
    }
  });

  app.delete('/api/tienda/admin/imagenes/:id', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const i = (await db.query('SELECT id,nombre_guardado,almacen FROM tienda_imagenes WHERE id=$1', [intId(req.params.id)])).rows[0];
      if (!i) return res.status(404).json({ error: 'Imagen no encontrada' });
      await db.query('DELETE FROM tienda_imagenes WHERE id=$1', [i.id]);
      await fotos.borrar([i]);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo borrar la imagen' });
    }
  });

  app.get('/api/tienda/admin/categorias', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      res.json((await db.query('SELECT * FROM tienda_categorias ORDER BY orden, nombre')).rows.map((c) => ({ id: String(c.id), nombre: c.nombre, slug: c.slug, orden: num(c.orden), activa: !!c.activa })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar las categorías' }); }
  });

  app.post('/api/tienda/admin/categorias', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const nombre = texto(req.body?.nombre, 80);
      if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const slug = slugDe(nombre);
      if ((await db.query('SELECT id FROM tienda_categorias WHERE slug=$1', [slug])).rows.length) return res.status(409).json({ error: 'Esa categoría ya existe' });
      const r = await db.query('INSERT INTO tienda_categorias(nombre,slug,orden) VALUES($1,$2,$3) RETURNING id', [nombre, slug, Math.trunc(num(req.body?.orden))]);
      res.status(201).json({ ok: true, id: String(r.rows[0].id), slug });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo crear la categoría' }); }
  });

  app.put('/api/tienda/admin/categorias/:id', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const nombre = texto(req.body?.nombre, 80);
      if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
      const r = await db.query('UPDATE tienda_categorias SET nombre=$1, orden=$2, activa=$3 WHERE id=$4', [nombre, Math.trunc(num(req.body?.orden)), req.body?.activa !== false, intId(req.params.id)]);
      if (!r.rowCount) return res.status(404).json({ error: 'Categoría no encontrada' });
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar la categoría' }); }
  });

  /** Reemplaza la lista de destinos. Los que no vengan se desactivan (los pedidos guardan el nombre y el costo). */
  app.put('/api/tienda/admin/destinos', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const lista = Array.isArray(req.body?.destinos) ? req.body.destinos.slice(0, 40) : null;
      if (!lista?.length) return res.status(400).json({ error: 'Indica al menos un destino' });
      for (const d of lista) {
        if (!texto(d?.nombre, 80) || !(Number(d?.costoUsd) >= 0) || !(Number.isInteger(Number(d?.diasExtra)) && Number(d.diasExtra) >= 0)) return res.status(400).json({ error: 'Cada destino necesita nombre, costo (0 o más) y días extra' });
      }
      const existentes = (await db.query('SELECT id FROM tienda_destinos')).rows.map((d) => Number(d.id));
      const vistos = new Set();
      for (const [i, d] of lista.entries()) {
        const fila = [texto(d.nombre, 80), Number(d.costoUsd), Number(d.diasExtra), d.requiereDireccion !== false, i];
        const id = intId(d.id);
        if (id && existentes.includes(id)) { await db.query('UPDATE tienda_destinos SET nombre=$1,costo_usd=$2,dias_extra=$3,requiere_direccion=$4,orden=$5,activo=TRUE WHERE id=$6', [...fila, id]); vistos.add(id); }
        else await db.query('INSERT INTO tienda_destinos(nombre,costo_usd,dias_extra,requiere_direccion,orden) VALUES($1,$2,$3,$4,$5)', fila);
      }
      for (const id of existentes) if (!vistos.has(id)) await db.query('UPDATE tienda_destinos SET activo=FALSE WHERE id=$1', [id]);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron guardar los destinos' }); }
  });

  app.get('/api/tienda/admin/pedidos', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      await vencerReservas();
      const estado = Object.hasOwn(ESTADOS, req.query.estado) ? req.query.estado : null;
      const pedidos = (await db.query(`SELECT * FROM tienda_pedidos ${estado ? 'WHERE estado=$1' : ''} ORDER BY id DESC LIMIT 300`, estado ? [estado] : [])).rows;
      const ids = pedidos.map((p) => Number(p.id));
      const items = ids.length ? (await db.query('SELECT * FROM tienda_pedido_items WHERE pedido_id = ANY($1::int[]) ORDER BY id', [ids])).rows : [];
      res.json(pedidos.map((p) => ({
        id: String(p.id), numero: p.numero, estado: p.estado, estadoTexto: ESTADOS[p.estado] || p.estado, siguientes: SIGUIENTES[p.estado] || [],
        nombre: p.nombre, telefono: p.telefono, email: p.email || '', cedula: p.cedula || '', destino: p.destino, direccion: p.direccion || '',
        subtotalUsd: num(p.subtotal_usd), envioUsd: num(p.envio_usd), totalUsd: num(p.total_usd),
        metodoPago: METODOS_PAGO[p.metodo_pago] || p.metodo_pago, referenciaPago: p.referencia_pago || '', venceEn: instanteISO(p.vence_en), notas: p.notas || '',
        clienteId: p.cliente_id ? `c${p.cliente_id}` : '', creadoEn: instanteISO(p.creado_en),
        items: items.filter((i) => i.pedido_id === p.id).map((i) => ({ nombre: i.nombre, variante: i.variante, precioUsd: num(i.precio_usd), cantidad: num(i.cantidad), contenedorId: i.contenedor_id ? String(i.contenedor_id) : '' })),
      })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar los pedidos' }); }
  });

  app.put('/api/tienda/admin/pedidos/:id/estado', auth, async (req, res) => {
    let tx;
    try {
      if (!soloAdmin(req, res)) return;
      const id = intId(req.params.id);
      const nuevo = String(req.body?.estado || '');
      tx = await db.connect();
      await tx.query('BEGIN');
      const p = (await tx.query('SELECT id,numero,estado FROM tienda_pedidos WHERE id=$1', [id])).rows[0];
      if (!p) { await tx.query('ROLLBACK'); return res.status(404).json({ error: 'Pedido no encontrado' }); }
      if (!(SIGUIENTES[p.estado] || []).includes(nuevo)) { await tx.query('ROLLBACK'); return res.status(409).json({ error: `No se puede pasar de «${ESTADOS[p.estado]}» a «${ESTADOS[nuevo] || nuevo}».` }); }
      // Condición sobre el estado anterior: si otra persona lo cambió a la vez, no se aplica dos veces.
      const r = await tx.query('UPDATE tienda_pedidos SET estado=$1, notas=COALESCE($2, notas), actualizado_en=CURRENT_TIMESTAMP WHERE id=$3 AND estado=$4', [nuevo, texto(req.body?.nota, 1000) || null, id, p.estado]);
      if (!r.rowCount) { await tx.query('ROLLBACK'); return res.status(409).json({ error: 'El pedido cambió mientras tanto. Recarga la lista.' }); }
      if (LIBERAN_CUPO.includes(nuevo)) await devolverCupo(tx, id);
      await tx.query('COMMIT');
      await logAction(req.user.id, `Pedido ${p.numero}: ${ESTADOS[nuevo]}`, 'tienda_pedidos', id, `De «${ESTADOS[p.estado]}» a «${ESTADOS[nuevo]}».`);
      res.json({ ok: true, estado: nuevo });
    } catch (e) {
      if (tx) await tx.query('ROLLBACK').catch(() => {});
      console.error(e);
      res.status(500).json({ error: 'No se pudo cambiar el estado' });
    } finally {
      tx?.release?.();
    }
  });

  // La carga masiva (tienda-lote.js) guarda cada fila con la misma validación que el formulario del panel.
  return { persistirProducto, slugDe };
}

module.exports = { ensureSchema, registrar, ESTADOS, METODOS_PAGO };
