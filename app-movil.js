/**
 * API de la app móvil de clientes (Caribe Cargo) y utilidades de avisos.
 *
 * - /api/app/*            : lo que consume la app. Solo con token de CLIENTE (jwt con typ:'cliente'); el token de
 *                           personal (uid) no sirve aquí y el de cliente no sirve en las rutas internas.
 * - /api/clientes/:id/clave, /api/etiquetas/:id/lotes y /fotos : lo que usa el personal para alimentar la app.
 * Cada consulta de /api/app filtra por el cliente de la sesión: nadie ve etiquetas ajenas.
 */
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const almacen = require('./almacen');

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MIN_CLAVE = 8;
const TIPOS_AVISO = ['almacen', 'transito', 'puerto', 'fotos'];

/* ---------- utilidades ---------- */

function aFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  // SQLite guarda "YYYY-MM-DD HH:MM:SS" en UTC sin zona; Postgres entrega Date.
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function corta(v) {
  const d = aFecha(v);
  return d ? `${String(d.getUTCDate()).padStart(2, '0')} ${MESES[d.getUTCMonth()]}` : '';
}

function hace(v) {
  const d = aFecha(v);
  if (!d) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return corta(d);
}

const num = (v) => (v == null || v === '' ? 0 : Number(v));

/** Estado interno de la etiqueta (prep|transit|ve|facturado|done|closed) → estado que ve el cliente. */
function estadoApp(estado, tieneContenedor) {
  switch (estado) {
    case 'transit': return 'transito';
    case 've': return 'puerto';
    case 'facturado':
    case 'done':
    case 'closed': return 'entregado';
    default: return tieneContenedor ? 'consolidado' : 'almacen';
  }
}

const AVISO_POR_ESTADO = {
  almacen: { tipo: 'almacen', titulo: 'Carga recibida en almacén', cuerpo: (e) => `Recibimos tu carga ${e.numero} en el almacén de Yiwu.` },
  consolidado: { tipo: 'almacen', titulo: 'Tu carga fue consolidada', cuerpo: (e, c) => `${e.numero} fue asignada al contenedor ${c?.numero || ''}.`.replace('  ', ' ') },
  transito: { tipo: 'transito', titulo: 'Tu contenedor zarpó', cuerpo: (e, c) => `${e.numero} viaja en ${c?.numero || 'su contenedor'}.${c?.fecha_estimada ? ` Llegada estimada: ${corta(c.fecha_estimada)}.` : ''}` },
  puerto: { tipo: 'puerto', titulo: 'Tu carga llegó a puerto', cuerpo: (e) => `${e.numero} está en Puerto Cabello. Te avisamos cuando esté lista para retiro.` },
  entregado: { tipo: 'puerto', titulo: 'Tu carga fue entregada', cuerpo: (e) => `${e.numero} fue entregada. ¡Gracias por confiar en nosotros!` },
};

/* ---------- esquema ---------- */

async function ensureSchema(db) {
  await db.query('ALTER TABLE clientes ADD COLUMN IF NOT EXISTS clave_hash TEXT');
  await db.query('CREATE TABLE IF NOT EXISTS etiqueta_lotes (id SERIAL PRIMARY KEY, etiqueta_id INTEGER NOT NULL, nombre VARCHAR(80) NOT NULL, cajas INTEGER NOT NULL, kg_por_caja NUMERIC(10,2) NOT NULL, largo_cm NUMERIC(10,2), ancho_cm NUMERIC(10,2), alto_cm NUMERIC(10,2))');
  await db.query('CREATE TABLE IF NOT EXISTS etiqueta_fotos (id SERIAL PRIMARY KEY, etiqueta_id INTEGER NOT NULL, titulo VARCHAR(120), lugar VARCHAR(120), nombre_guardado VARCHAR(255) NOT NULL, mime_type VARCHAR(100) NOT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.query("ALTER TABLE etiqueta_fotos ADD COLUMN IF NOT EXISTS almacen VARCHAR(10) NOT NULL DEFAULT 'disco'");
  await db.query('CREATE TABLE IF NOT EXISTS cliente_preferencias (cliente_id INTEGER PRIMARY KEY, almacen BOOLEAN NOT NULL DEFAULT TRUE, transito BOOLEAN NOT NULL DEFAULT TRUE, puerto BOOLEAN NOT NULL DEFAULT TRUE, fotos BOOLEAN NOT NULL DEFAULT FALSE)');
  await db.query('CREATE TABLE IF NOT EXISTS cliente_dispositivos (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL, push_token VARCHAR(255) NOT NULL UNIQUE, plataforma VARCHAR(20), creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE IF NOT EXISTS cliente_avisos (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL, etiqueta_id INTEGER, titulo VARCHAR(200) NOT NULL, cuerpo TEXT NOT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

/* ---------- avisos y push ---------- */

async function leerPrefs(db, clienteId) {
  const r = await db.query('SELECT almacen,transito,puerto,fotos FROM cliente_preferencias WHERE cliente_id=$1', [clienteId]);
  const p = r.rows[0] || { almacen: true, transito: true, puerto: true, fotos: false };
  return { almacen: !!p.almacen, transito: !!p.transito, puerto: !!p.puerto, fotos: !!p.fotos };
}

/** Guarda el aviso (siempre, para el historial) y lo empuja al teléfono si el cliente lo pidió. Nunca lanza. */
async function notificar(db, { clienteId, etiquetaId, tipo, titulo, cuerpo }) {
  try {
    if (!clienteId) return;
    await db.query('INSERT INTO cliente_avisos(cliente_id,etiqueta_id,titulo,cuerpo) VALUES($1,$2,$3,$4)', [clienteId, etiquetaId || null, titulo, cuerpo]);
    const prefs = await leerPrefs(db, clienteId);
    if (!prefs[tipo]) return;
    const disp = await db.query('SELECT push_token FROM cliente_dispositivos WHERE cliente_id=$1', [clienteId]);
    if (!disp.rows.length) return;
    const mensajes = disp.rows.map((d) => ({ to: d.push_token, title: titulo, body: cuerpo, sound: 'default', channelId: 'seguimiento', data: { etiquetaId: etiquetaId ? String(etiquetaId) : null } }));
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(mensajes),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error('Aviso al cliente no enviado:', e.message);
  }
}

/** Llamar tras cambiar una etiqueta: avisa solo si el estado que ve el cliente cambió. */
async function avisarCambioDeEstado(db, antes, despues) {
  try {
    if (!despues || !despues.cliente_id) return;
    const nuevo = estadoApp(despues.estado, !!despues.contenedor_id);
    if (antes && estadoApp(antes.estado, !!antes.contenedor_id) === nuevo) return;
    const a = AVISO_POR_ESTADO[nuevo];
    const c = despues.contenedor_id
      ? (await db.query('SELECT numero,fecha_estimada FROM contenedores WHERE id=$1', [despues.contenedor_id])).rows[0]
      : null;
    await notificar(db, { clienteId: despues.cliente_id, etiquetaId: despues.id, tipo: a.tipo, titulo: a.titulo, cuerpo: a.cuerpo(despues, c) });
  } catch (e) {
    console.error('No se pudo avisar el cambio de estado:', e.message);
  }
}

/* ---------- fotos ---------- */

function tipoDeImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  return null;
}

const subirFotos = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(/^image\/(jpeg|png)$/i.test(String(file.mimetype || '')) ? null : new Error('Solo se aceptan fotos JPG o PNG.'), /^image\/(jpeg|png)$/i.test(String(file.mimetype || ''))),
});

/* ---------- rutas ---------- */

/** Fotos de las etiquetas dadas, para borrar sus archivos DESPUÉS de borrar las filas (las filas caen en cascada). */
async function fotosDeEtiquetas(db, ids) {
  const lista = (ids || []).filter((x) => Number.isInteger(Number(x))).map(Number);
  if (!lista.length) return [];
  return (await db.query('SELECT almacen,nombre_guardado FROM etiqueta_fotos WHERE etiqueta_id = ANY($1::int[])', [lista])).rows;
}

async function fotosDeCliente(db, clienteId) {
  return (await db.query('SELECT f.almacen,f.nombre_guardado FROM etiqueta_fotos f JOIN etiquetas e ON e.id=f.etiqueta_id WHERE e.cliente_id=$1', [clienteId])).rows;
}

function registrar(app, { db, JWT_SECRET, loginLimiter, auth, intId, logAction }) {
  if (almacen.hayStorage()) {
    // En Vercel no se revisa en cada arranque en frío: los buckets los crean las migraciones.
    if (!process.env.VERCEL) {
      almacen.asegurarBucket().then(
        () => console.log(`🗂️  Fotos de etiquetas en Supabase Storage (bucket ${almacen.BUCKET}).`),
        (e) => console.error('⚠️', e.message)
      );
    }
  } else {
    console.log('🗂️  Fotos de etiquetas en disco local (define SUPABASE_URL y SUPABASE_SECRET_KEY para usar Supabase Storage).');
  }

  // La sesión del cliente lleva una huella de su clave: si el personal cambia la clave, las sesiones anteriores dejan de valer.
  const huellaClave = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);
  // Hash de relleno para que el login tarde lo mismo exista o no el código (no revela qué códigos existen).
  let hashRelleno = null;
  const rellenoBcrypt = () => hashRelleno || (hashRelleno = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12));

  async function authCliente(req, res, next) {
    try {
      const h = req.headers.authorization || '';
      const payload = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', JWT_SECRET);
      if (payload.typ !== 'cliente' || !payload.cid) return res.status(401).json({ error: 'Sesión inválida' });
      const r = await db.query('SELECT id,codigo_cliente,nombre,apellido,asesora_id,clave_hash FROM clientes WHERE id=$1 AND clave_hash IS NOT NULL', [payload.cid]);
      if (!r.rows.length || payload.v !== huellaClave(r.rows[0].clave_hash)) return res.status(401).json({ error: 'Sesión inválida' });
      req.cliente = r.rows[0];
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }
  }

  async function armarEtiqueta(e, { detalle }) {
    const c = e.contenedor_id ? (await db.query("SELECT numero,fecha_salida,fecha_estimada,fecha_llegada FROM contenedores WHERE id=$1", [e.contenedor_id])).rows[0] : null;
    const estado = estadoApp(e.estado, !!e.contenedor_id);
    const total = num(e.cajas_packing_list);
    const recibidas = num(e.cajas_en_china);
    const eta = c ? corta(c.fecha_estimada) : '';
    const zarpe = c ? corta(c.fecha_salida) : '';
    const llegada = c ? corta(c.fecha_llegada) : '';

    const resumenFecha = { entregado: 'Entregada', puerto: llegada ? `En Puerto Cabello desde el ${llegada}` : 'En Puerto Cabello' }[estado] || (eta ? `Llegada estimada: ${eta}` : 'Llegada por confirmar');
    const frase = {
      almacen: `Recibimos ${recibidas} de ${total} cajas en Yiwu.`,
      consolidado: `Asignada al contenedor ${c?.numero || ''}.`.replace(' .', '.'),
      transito: eta ? `Llega a Puerto Cabello el ${eta}.` : 'Va rumbo a Puerto Cabello.',
      puerto: 'Te avisamos cuando esté lista para retiro.',
      entregado: 'Entregada. ¡Gracias por confiar en nosotros!',
    }[estado];

    const salida = {
      id: String(e.id),
      numero: e.numero,
      mercancia: e.tipo_mercancia || 'Mercancía general',
      estado,
      cajasRecibidas: recibidas,
      cajasTotales: total,
      contenedor: c?.numero || 'Sin asignar',
      volumenM3: num(e.cbm_real_china),
      pesoKg: 0,
      resumenFecha,
      frase,
      recibidoAlmacen: corta(e.fecha_creacion),
      zarpe,
      eta,
      lotes: [],
      fotos: [],
      hitos: [],
    };
    if (process.env.APP_WHATSAPP) salida.asesoraTelefono = process.env.APP_WHATSAPP;
    if (!detalle) return salida;

    const lotes = (await db.query('SELECT nombre,cajas,kg_por_caja,largo_cm,ancho_cm,alto_cm FROM etiqueta_lotes WHERE etiqueta_id=$1 ORDER BY id', [e.id])).rows;
    salida.lotes = lotes.map((l) => ({ nombre: l.nombre, cajas: num(l.cajas), kgPorCaja: num(l.kg_por_caja), largoCm: num(l.largo_cm), anchoCm: num(l.ancho_cm), altoCm: num(l.alto_cm) }));
    salida.pesoKg = Math.round(salida.lotes.reduce((s, l) => s + l.cajas * l.kgPorCaja, 0) * 100) / 100;
    const fotos = (await db.query('SELECT id,titulo,lugar,creado_en FROM etiqueta_fotos WHERE etiqueta_id=$1 ORDER BY id', [e.id])).rows;
    salida.fotos = fotos.map((f) => ({ id: String(f.id), titulo: f.titulo || 'Foto de la carga', lugar: f.lugar || 'Yiwu', fecha: corta(f.creado_en), uri: `/api/app/fotos/${f.id}` }));

    const orden = ['almacen', 'consolidado', 'transito', 'puerto', 'entregado'];
    const alcanzado = (s) => orden.indexOf(s) <= orden.indexOf(estado);
    salida.hitos = [
      { estado: 'almacen', detalle: 'Yiwu, China', fecha: corta(e.fecha_creacion) },
      { estado: 'consolidado', detalle: 'Asignado a contenedor', fecha: alcanzado('consolidado') && c ? corta(e.fecha_creacion) : '' },
      { estado: 'transito', detalle: 'Vía marítima', fecha: alcanzado('transito') ? zarpe : '' },
      { estado: 'puerto', detalle: 'Puerto Cabello', fecha: alcanzado('puerto') ? llegada : eta ? `Est. ${eta}` : '' },
      { estado: 'entregado', detalle: 'Valencia', fecha: '' },
    ];
    return salida;
  }

  app.post('/api/app/login', loginLimiter, async (req, res) => {
    try {
      const codigo = String(req.body?.codigo || '').trim();
      const clave = String(req.body?.clave || '');
      const r = await db.query('SELECT id,nombre,apellido,clave_hash FROM clientes WHERE UPPER(codigo_cliente)=UPPER($1) AND clave_hash IS NOT NULL', [codigo]);
      const coincide = await bcrypt.compare(clave, r.rows[0]?.clave_hash || rellenoBcrypt());
      if (!r.rows.length || !coincide) return res.status(401).json({ error: 'Código o clave incorrectos.' });
      const c = r.rows[0];
      const token = jwt.sign({ cid: c.id, typ: 'cliente', v: huellaClave(c.clave_hash) }, JWT_SECRET, { expiresIn: '30d' });
      res.json({ token, cliente: [c.nombre, c.apellido].filter(Boolean).join(' ') });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error iniciando sesión' });
    }
  });

  /**
   * «Mis datos»: los mismos que tiene el panel administrativo (misma fila de clientes), solo los que corresponde mostrar al cliente.
   * No se exponen las observaciones internas ni el estado de atención: son notas del equipo.
   */
  app.get('/api/app/perfil', authCliente, async (req, res) => {
    try {
      const c = (await db.query('SELECT * FROM clientes WHERE id=$1', [req.cliente.id])).rows[0];
      const asesora = c.asesora_id ? (await db.query('SELECT nombre,codigo_asesora FROM usuarios WHERE id=$1', [c.asesora_id])).rows[0] : null;
      const desde = aFecha(c.fecha_registro);
      res.json({
        code: c.codigo_cliente || '',
        name: [c.nombre, c.apellido].filter(Boolean).join(' '),
        idNumber: c.cedula || '',
        phone: c.telefono || '',
        email: c.email || '',
        company: c.empresa || '',
        state: c.estado_venezuela || '',
        advisor: asesora ? { name: asesora.nombre, code: asesora.codigo_asesora || '' } : null,
        since: desde ? `${corta(desde)} ${desde.getUTCFullYear()}` : '',
        contactWhatsapp: process.env.APP_WHATSAPP || '',
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar tus datos' });
    }
  });

  app.get('/api/app/etiquetas', authCliente, async (req, res) => {
    try {
      const r = await db.query('SELECT * FROM etiquetas WHERE cliente_id=$1 ORDER BY id DESC', [req.cliente.id]);
      res.json(await Promise.all(r.rows.map((e) => armarEtiqueta(e, { detalle: false }))));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar las etiquetas' });
    }
  });

  app.get('/api/app/etiquetas/:id', authCliente, async (req, res) => {
    try {
      const id = intId(req.params.id);
      const r = await db.query('SELECT * FROM etiquetas WHERE id=$1 AND cliente_id=$2', [id, req.cliente.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
      res.json(await armarEtiqueta(r.rows[0], { detalle: true }));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la etiqueta' });
    }
  });

  app.get('/api/app/fotos/:id', authCliente, async (req, res) => {
    try {
      const id = intId(req.params.id);
      const r = await db.query('SELECT f.nombre_guardado,f.mime_type,f.almacen FROM etiqueta_fotos f JOIN etiquetas e ON e.id=f.etiqueta_id WHERE f.id=$1 AND e.cliente_id=$2', [id, req.cliente.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Foto no encontrada' });
      const contenido = await almacen.leer(r.rows[0].almacen, r.rows[0].nombre_guardado);
      if (!contenido) return res.status(404).json({ error: 'Foto no encontrada' });
      res.setHeader('Content-Type', r.rows[0].mime_type);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(contenido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la foto' });
    }
  });

  app.get('/api/app/avisos', authCliente, async (req, res) => {
    try {
      const r = await db.query('SELECT id,etiqueta_id,titulo,cuerpo,creado_en FROM cliente_avisos WHERE cliente_id=$1 ORDER BY id DESC LIMIT 50', [req.cliente.id]);
      res.json(r.rows.map((a) => ({ id: String(a.id), titulo: a.titulo, cuerpo: a.cuerpo, cuando: hace(a.creado_en), etiquetaId: a.etiqueta_id ? String(a.etiqueta_id) : undefined })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar los avisos' });
    }
  });

  app.get('/api/app/preferencias', authCliente, async (req, res) => {
    try {
      res.json(await leerPrefs(db, req.cliente.id));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar las preferencias' });
    }
  });

  app.put('/api/app/preferencias', authCliente, async (req, res) => {
    try {
      const b = req.body || {};
      if (!TIPOS_AVISO.every((k) => typeof b[k] === 'boolean')) return res.status(400).json({ error: 'Preferencias no válidas' });
      await db.query(
        `INSERT INTO cliente_preferencias(cliente_id,almacen,transito,puerto,fotos) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (cliente_id) DO UPDATE SET almacen=$2,transito=$3,puerto=$4,fotos=$5`,
        [req.cliente.id, b.almacen, b.transito, b.puerto, b.fotos]
      );
      res.json(await leerPrefs(db, req.cliente.id));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron guardar las preferencias' });
    }
  });

  app.post('/api/app/dispositivos', authCliente, async (req, res) => {
    try {
      const token = String(req.body?.pushToken || '').trim();
      if (!/^Expo(nent)?PushToken\[[^\]]{10,200}\]$/.test(token)) return res.status(400).json({ error: 'Token de notificaciones no válido' });
      const plataforma = ['ios', 'android'].includes(req.body?.plataforma) ? req.body.plataforma : null;
      // El mismo teléfono puede cambiar de cliente: el token se reasigna a la sesión actual.
      await db.query(
        `INSERT INTO cliente_dispositivos(cliente_id,push_token,plataforma) VALUES($1,$2,$3)
         ON CONFLICT (push_token) DO UPDATE SET cliente_id=$1,plataforma=$3`,
        [req.cliente.id, token, plataforma]
      );
      res.status(201).json({});
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo registrar el dispositivo' });
    }
  });

  /* ----- personal: alimentan la app ----- */

  async function etiquetaPermitida(req, res) {
    const id = intId(req.params.id);
    const r = await db.query('SELECT e.*,c.asesora_id FROM etiquetas e LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=$1', [id]);
    if (!r.rows.length) { res.status(404).json({ error: 'Etiqueta no encontrada' }); return null; }
    if (req.user.rol !== 'admin' && r.rows[0].asesora_id !== req.user.id) { res.status(403).json({ error: 'No tienes permiso' }); return null; }
    return r.rows[0];
  }

  /** Lotes y fotos de una etiqueta tal como los ve el personal (para la pantalla de edición del panel). */
  app.get('/api/etiquetas/:id/app', auth, async (req, res) => {
    try {
      const e = await etiquetaPermitida(req, res);
      if (!e) return;
      const lotes = (await db.query('SELECT nombre,cajas,kg_por_caja,largo_cm,ancho_cm,alto_cm FROM etiqueta_lotes WHERE etiqueta_id=$1 ORDER BY id', [e.id])).rows;
      const fotos = (await db.query('SELECT id,titulo,lugar,creado_en FROM etiqueta_fotos WHERE etiqueta_id=$1 ORDER BY id', [e.id])).rows;
      const cliente = e.cliente_id ? (await db.query('SELECT codigo_cliente,clave_hash FROM clientes WHERE id=$1', [e.cliente_id])).rows[0] : null;
      res.json({
        clientCode: cliente?.codigo_cliente || '', clientHasAccess: !!cliente?.clave_hash,
        lots: lotes.map((l) => ({ name: l.nombre, boxes: num(l.cajas), kgPerBox: num(l.kg_por_caja), lengthCm: num(l.largo_cm), widthCm: num(l.ancho_cm), heightCm: num(l.alto_cm) })),
        photos: fotos.map((f) => ({ id: String(f.id), title: f.titulo || '', place: f.lugar || '', date: corta(f.creado_en) })),
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo cargar la información de la app' }); }
  });

  app.get('/api/etiquetas/:id/fotos/:fotoId/archivo', auth, async (req, res) => {
    try {
      const e = await etiquetaPermitida(req, res);
      if (!e) return;
      const f = (await db.query('SELECT nombre_guardado,mime_type,almacen FROM etiqueta_fotos WHERE id=$1 AND etiqueta_id=$2', [intId(req.params.fotoId), e.id])).rows[0];
      if (!f) return res.status(404).json({ error: 'Foto no encontrada' });
      const contenido = await almacen.leer(f.almacen, f.nombre_guardado);
      if (!contenido) return res.status(404).json({ error: 'Foto no encontrada' });
      res.setHeader('Content-Type', f.mime_type);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.send(contenido);
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo cargar la foto' }); }
  });

  app.put('/api/clientes/:id/clave', auth, async (req, res) => {
    try {
      const id = intId(req.params.id);
      const r = await db.query('SELECT id,codigo_cliente,asesora_id FROM clientes WHERE id=$1', [id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
      if (req.user.rol !== 'admin' && r.rows[0].asesora_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso' });
      const clave = String(req.body?.clave || '');
      if (clave.length < MIN_CLAVE) return res.status(400).json({ error: `La clave debe tener al menos ${MIN_CLAVE} caracteres` });
      await db.query('UPDATE clientes SET clave_hash=$1 WHERE id=$2', [await bcrypt.hash(clave, 12), id]);
      await logAction(req.user.id, `Acceso a la app de ${r.rows[0].codigo_cliente}`, 'clientes', id, 'Se definió la clave de acceso a la app móvil.');
      res.json({ ok: true, codigo: r.rows[0].codigo_cliente });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo guardar la clave' });
    }
  });

  app.put('/api/etiquetas/:id/lotes', auth, async (req, res) => {
    try {
      const e = await etiquetaPermitida(req, res);
      if (!e) return;
      const lotes = Array.isArray(req.body?.lotes) ? req.body.lotes : null;
      if (!lotes || lotes.length > 50) return res.status(400).json({ error: 'Lotes no válidos' });
      const limpios = lotes.map((l) => ({ nombre: String(l?.nombre || '').trim().slice(0, 80), cajas: Math.trunc(Number(l?.cajas)), kg: Number(l?.kgPorCaja), la: Number(l?.largoCm), an: Number(l?.anchoCm), al: Number(l?.altoCm) }));
      if (limpios.some((l) => !l.nombre || !(l.cajas > 0) || !(l.kg > 0) || [l.la, l.an, l.al].some((d) => !(d > 0)))) {
        return res.status(400).json({ error: 'Cada lote necesita nombre, cajas, kg por caja y dimensiones mayores que cero' });
      }
      await db.query('DELETE FROM etiqueta_lotes WHERE etiqueta_id=$1', [e.id]);
      for (const l of limpios) {
        await db.query('INSERT INTO etiqueta_lotes(etiqueta_id,nombre,cajas,kg_por_caja,largo_cm,ancho_cm,alto_cm) VALUES($1,$2,$3,$4,$5,$6,$7)', [e.id, l.nombre, l.cajas, l.kg, l.la, l.an, l.al]);
      }
      await logAction(req.user.id, `Lotes de ${e.numero} actualizados`, 'etiquetas', e.id, `${limpios.length} lote(s).`);
      res.json({ ok: true, lotes: limpios.length });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron guardar los lotes' });
    }
  });

  app.post('/api/etiquetas/:id/fotos', auth, subirFotos.array('fotos', 10), async (req, res) => {
    try {
      const e = await etiquetaPermitida(req, res);
      if (!e) return;
      const archivos = Array.isArray(req.files) ? req.files : [];
      if (!archivos.length) return res.status(400).json({ error: 'Adjunta al menos una foto' });
      const titulo = String(req.body?.titulo || '').trim().slice(0, 120) || null;
      const lugar = String(req.body?.lugar || '').trim().slice(0, 120) || 'Yiwu';
      let guardadas = 0;
      for (const f of archivos) {
        const tipo = tipoDeImagen(f.buffer); // se confía en los bytes, no en el nombre ni en el tipo declarado
        if (!tipo) continue;
        const nombre = `e${e.id}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}${tipo.ext}`;
        const guardado = await almacen.guardar(nombre, f.buffer, tipo.mime);
        await db.query('INSERT INTO etiqueta_fotos(etiqueta_id,titulo,lugar,nombre_guardado,mime_type,almacen) VALUES($1,$2,$3,$4,$5,$6)', [e.id, titulo, lugar, guardado.clave, tipo.mime, guardado.almacen]);
        guardadas++;
      }
      if (!guardadas) return res.status(400).json({ error: 'Los archivos no son fotos JPG o PNG válidas' });
      await logAction(req.user.id, `Fotos de ${e.numero}`, 'etiquetas', e.id, `${guardadas} foto(s) agregada(s).`);
      await notificar(db, { clienteId: e.cliente_id, etiquetaId: e.id, tipo: 'fotos', titulo: 'Nuevas fotos de tu carga', cuerpo: `Subimos ${guardadas} foto(s) de ${e.numero}. Míralas en la app.` });
      res.status(201).json({ ok: true, guardadas });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron guardar las fotos' });
    }
  });

  app.delete('/api/etiquetas/:id/fotos/:fotoId', auth, async (req, res) => {
    try {
      const e = await etiquetaPermitida(req, res);
      if (!e) return;
      const f = await db.query('SELECT id,nombre_guardado,almacen FROM etiqueta_fotos WHERE id=$1 AND etiqueta_id=$2', [intId(req.params.fotoId), e.id]);
      if (!f.rows.length) return res.status(404).json({ error: 'Foto no encontrada' });
      await db.query('DELETE FROM etiqueta_fotos WHERE id=$1', [f.rows[0].id]);
      await almacen.borrar([f.rows[0]]);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo eliminar la foto' });
    }
  });
}

module.exports = { ensureSchema, registrar, avisarCambioDeEstado, estadoApp, fotosDeEtiquetas, fotosDeCliente, borrarArchivos: almacen.borrar };
