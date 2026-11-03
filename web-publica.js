/**
 * API pública de la web de Criollo Cargo (sin sesión). Lee los MISMOS datos que el panel: contenedores, etiquetas…
 *
 *   GET  /api/web/zarpes              → contenedores publicados en la web: cierre, llegada, ocupación y estado
 *   GET  /api/web/rastreo/:codigo     → etapa de una etiqueta (LC-…) o de un contenedor; sin datos del cliente
 *   GET  /api/web/tarifas             → tarifas de referencia (tarifas.js) para cotizar en el navegador
 *   POST /api/web/cotizar             → la misma cotización calculada en el servidor
 *   POST /api/web/solicitudes         → «Reservar espacio», contacto o «avísame» de la tienda: llega al panel
 *
 * Personal (con sesión):
 *   GET  /api/web/solicitudes · PUT /api/web/solicitudes/:id   (admin: lista y marca atendida)
 *   PUT  /api/contenedores/:id/web                              (admin: publicar en la web, cierre, capacidad, ruta)
 */
const rateLimit = require('express-rate-limit');
const tarifas = require('./tarifas');

const ETAPAS = ['Recepción', 'Consolidado', 'Zarpe', 'Altamar', 'Entrega'];
const TIPOS_SOLICITUD = ['reserva', 'contacto', 'aviso_producto'];
const DIA_MS = 24 * 60 * 60 * 1000;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const num = (v) => (v == null || v === '' ? 0 : Number(v));
const fechaISO = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** Instante en ISO con zona (Postgres entrega Date; SQLite, texto UTC sin zona que el navegador leería como hora local). */
const instanteISO = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

async function ensureSchema(db) {
  // Lo que la web necesita de cada contenedor; el panel los edita (PUT /api/contenedores/:id/web).
  await db.query('ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS publicar_web BOOLEAN NOT NULL DEFAULT FALSE');
  await db.query('ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS fecha_cierre DATE');
  await db.query(`ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS capacidad_cbm NUMERIC(8,2) NOT NULL DEFAULT ${tarifas.CAPACIDAD_CONTENEDOR_CBM}`);
  await db.query('ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS ruta VARCHAR(120)');
  await db.query(`CREATE TABLE IF NOT EXISTS web_solicitudes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    telefono VARCHAR(50),
    email VARCHAR(150),
    estado_venezuela VARCHAR(80),
    mensaje TEXT,
    datos TEXT,
    producto_id INTEGER,
    atendida BOOLEAN NOT NULL DEFAULT FALSE,
    atendida_por INTEGER,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query('CREATE INDEX IF NOT EXISTS web_solicitudes_atendida_idx ON web_solicitudes(atendida, creado_en)');
}

/** Ocupación (CBM) de cada contenedor: etiquetas principales (las subetiquetas heredan el volumen de su principal). */
async function ocupaciones(db, ids) {
  if (!ids.length) return new Map();
  const r = await db.query(
    'SELECT contenedor_id, SUM(COALESCE(cbm_real_china, cbm_packing_list, 0)) AS cbm FROM etiquetas WHERE contenedor_id = ANY($1::int[]) AND etiqueta_padre_id IS NULL GROUP BY contenedor_id',
    [ids]
  );
  return new Map(r.rows.map((x) => [Number(x.contenedor_id), num(x.cbm)]));
}

function estadoZarpe(c, pct, hoy) {
  if (c.estado === 'transit') return 'En tránsito';
  if (c.estado === 've') return 'En puerto';
  if (pct >= 95) return 'Lleno';
  const cierre = c.fecha_cierre ? new Date(fechaISO(c.fecha_cierre) + 'T00:00:00Z').getTime() : null;
  if (cierre != null && cierre < hoy) return 'Cerrado';
  if (cierre != null && cierre - hoy <= 7 * DIA_MS) return 'Cierra pronto';
  return 'Abierto';
}

/** Etapa que ve el público (ETAPAS) a partir del estado interno de la etiqueta o del contenedor. */
function etapa(estado, { tieneContenedor, zarpo }) {
  switch (estado) {
    case 'transit': return zarpo ? 3 : 2;
    case 've':
    case 'facturado':
    case 'done':
    case 'closed': return 4;
    default: return tieneContenedor ? 1 : 0;
  }
}

function registrar(app, { db, auth, intId, logAction }) {
  // Formularios públicos: pocos envíos por IP para frenar spam y bots.
  const limiteEnvios = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados envíos. Intenta de nuevo en unos minutos.' } });
  const limiteRastreo = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas. Espera un minuto.' } });
  const soloAdmin = (req, res) => {
    if (req.user.rol === 'admin') return true;
    res.status(403).json({ error: 'Solo el administrador' });
    return false;
  };

  app.get('/api/web/zarpes', async (req, res) => {
    try {
      const r = await db.query("SELECT id,numero,ruta,origen,estado,fecha_cierre,fecha_salida,fecha_estimada,capacidad_cbm FROM contenedores WHERE publicar_web = TRUE AND estado NOT IN ('done','closed') ORDER BY fecha_estimada");
      const occ = await ocupaciones(db, r.rows.map((c) => Number(c.id)));
      const hoy = Date.now();
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json(r.rows.map((c) => {
        const capacidad = num(c.capacidad_cbm) || tarifas.CAPACIDAD_CONTENEDOR_CBM;
        const pct = Math.round(Math.min(100, ((occ.get(Number(c.id)) || 0) / capacidad) * 100));
        return {
          contenedor: c.numero,
          ruta: c.ruta || `${c.origen || 'Yiwu'} → Puerto Cabello`,
          cierre: fechaISO(c.fecha_cierre),
          zarpe: fechaISO(c.fecha_salida),
          llegada: fechaISO(c.fecha_estimada),
          ocupacionPct: pct,
          estado: estadoZarpe(c, pct, hoy),
        };
      }));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar los zarpes' });
    }
  });

  /** Rastreo público: solo etapa y fechas. Nunca nombre, teléfono ni datos del cliente. */
  app.get('/api/web/rastreo/:codigo', limiteRastreo, async (req, res) => {
    try {
      const codigo = texto(req.params.codigo, 100);
      if (codigo.length < 3) return res.status(400).json({ error: 'Escribe el código de tu etiqueta o contenedor' });
      const hoy = new Date().toISOString().slice(0, 10);
      const e = (await db.query('SELECT numero,estado,contenedor_id,tipo_mercancia,cajas_packing_list FROM etiquetas WHERE UPPER(numero)=UPPER($1)', [codigo])).rows[0];
      let c = null;
      if (e?.contenedor_id) c = (await db.query('SELECT numero,estado,fecha_salida,fecha_estimada,fecha_llegada FROM contenedores WHERE id=$1', [e.contenedor_id])).rows[0];
      if (!e) c = (await db.query('SELECT numero,estado,fecha_salida,fecha_estimada,fecha_llegada FROM contenedores WHERE UPPER(numero)=UPPER($1)', [codigo])).rows[0];
      if (!e && !c) return res.status(404).json({ error: 'No encontramos ese código. Revisa que esté completo (por ejemplo LC-FAM-930).' });

      const zarpo = !!(c?.fecha_salida && fechaISO(c.fecha_salida) <= hoy);
      const paso = e ? etapa(e.estado, { tieneContenedor: !!c, zarpo }) : etapa(c.estado, { tieneContenedor: true, zarpo });
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        tipo: e ? 'etiqueta' : 'contenedor',
        codigo: e ? e.numero : c.numero,
        descripcion: e
          ? ['Etiqueta', [e.tipo_mercancia, e.cajas_packing_list ? `${e.cajas_packing_list} cajas` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
          : "Contenedor · Yiwu → Puerto Cabello",
        contenedor: c?.numero || null,
        llegada: fechaISO(c?.fecha_llegada) || fechaISO(c?.fecha_estimada),
        paso,
        etapas: ETAPAS,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo consultar el rastreo' });
    }
  });

  app.get('/api/web/tarifas', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(tarifas.publicas());
  });

  app.post('/api/web/cotizar', (req, res) => {
    const r = tarifas.cotizar(req.body || {});
    if (r.error) return res.status(400).json(r);
    res.json(r);
  });

  app.post('/api/web/solicitudes', limiteEnvios, async (req, res) => {
    try {
      const b = req.body || {};
      if (texto(b.sitioWeb, 200)) return res.status(201).json({ ok: true }); // trampa para bots: campo oculto en el formulario
      const tipo = TIPOS_SOLICITUD.includes(b.tipo) ? b.tipo : null;
      const nombre = texto(b.nombre, 150);
      const telefono = texto(b.telefono, 50).replace(/[^\d+\-\s()]/g, '');
      const email = texto(b.email, 150).toLowerCase();
      if (!tipo) return res.status(400).json({ error: 'Tipo de solicitud no válido' });
      if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre' });
      if (!telefono && !email) return res.status(400).json({ error: 'Déjanos un teléfono o un correo para contactarte' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'El correo no es válido' });

      // En «reserva» se guarda la cotización recalculada aquí (no la que mande el navegador).
      let datos = null;
      if (tipo === 'reserva' && b.cotizacion) {
        const cot = tarifas.cotizar(b.cotizacion);
        if (!cot.error) datos = JSON.stringify(cot);
      }
      const productoId = tipo === 'aviso_producto' ? intId(b.productoId) : null;
      await db.query(
        'INSERT INTO web_solicitudes(tipo,nombre,telefono,email,estado_venezuela,mensaje,datos,producto_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [tipo, nombre, telefono || null, email || null, texto(b.estado, 80) || null, texto(b.mensaje, 2000) || null, datos, productoId]
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo enviar tu solicitud' });
    }
  });

  /* ----- personal ----- */

  app.get('/api/web/solicitudes', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const pendientes = req.query.todas !== '1';
      const r = await db.query(`SELECT * FROM web_solicitudes ${pendientes ? 'WHERE atendida = FALSE' : ''} ORDER BY id DESC LIMIT 300`);
      res.json(r.rows.map((s) => ({
        id: String(s.id), tipo: s.tipo, nombre: s.nombre, telefono: s.telefono || '', email: s.email || '', estado: s.estado_venezuela || '',
        mensaje: s.mensaje || '', cotizacion: s.datos ? JSON.parse(s.datos) : null, productoId: s.producto_id ? String(s.producto_id) : null,
        atendida: !!s.atendida, creadoEn: instanteISO(s.creado_en),
      })));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar las solicitudes' });
    }
  });

  app.put('/api/web/solicitudes/:id', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const id = intId(req.params.id);
      const atendida = req.body?.atendida !== false;
      const r = await db.query('UPDATE web_solicitudes SET atendida=$1, atendida_por=$2 WHERE id=$3', [atendida, atendida ? req.user.id : null, id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada' });
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo actualizar la solicitud' });
    }
  });

  app.put('/api/contenedores/:id/web', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const id = intId(req.params.id);
      const b = req.body || {};
      const cierre = b.cierre ? fechaISO(b.cierre) : null;
      if (b.cierre && !cierre) return res.status(400).json({ error: 'Fecha de cierre no válida' });
      const capacidad = b.capacidadCbm == null || b.capacidadCbm === '' ? tarifas.CAPACIDAD_CONTENEDOR_CBM : Number(b.capacidadCbm);
      if (!(capacidad > 0 && capacidad <= 100)) return res.status(400).json({ error: 'La capacidad debe estar entre 0 y 100 m³' });
      const r = await db.query('UPDATE contenedores SET publicar_web=$1, fecha_cierre=$2, capacidad_cbm=$3, ruta=$4 WHERE id=$5 RETURNING numero', [!!b.publicar, cierre, capacidad, texto(b.ruta, 120) || null, id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Contenedor no encontrado' });
      await logAction(req.user.id, `Contenedor ${r.rows[0]?.numero || id} en la web`, 'contenedores', id, b.publicar ? 'Publicado en la web.' : 'Retirado de la web.');
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo guardar' });
    }
  });
}

module.exports = { ensureSchema, registrar, ETAPAS };
