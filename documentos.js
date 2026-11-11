/**
 * Documentos adjuntos de clientes (cédula, RIF…) y de etiquetas (packing list, fotos de la mercancía y de las cajas…).
 *
 *   GET    /api/clientes/:id/documentos      · GET    /api/etiquetas/:id/documentos      → lista
 *   POST   /api/clientes/:id/documentos      · POST   /api/etiquetas/:id/documentos      → multipart `archivos` + `tipo`
 *   GET    /api/documentos/:docId/archivo    → el archivo (con la sesión)
 *   DELETE /api/documentos/:docId
 *
 * Los ve y los sube el administrador o la asesora dueña del cliente (en una etiqueta, la del cliente de la etiqueta).
 * Los archivos van a Supabase Storage (bucket privado `documentos`) o, sin Storage, a uploads/documentos/.
 */
const path = require('path');
const multer = require('multer');
const almacen = require('./almacen');

const docs = almacen.crearAlmacen({ bucket: process.env.SUPABASE_BUCKET_DOCUMENTOS || 'documentos', carpetaDisco: path.join(__dirname, 'uploads', 'documentos') });

const MAX_BYTES = 10 * 1024 * 1024;

const TIPOS = {
  cliente: { cedula: 'Cédula', rif: 'RIF', registro: 'Registro mercantil', otro: 'Otro' },
  etiqueta: { packing_list: 'Packing list', factura: 'Factura comercial', fotos_mercancia: 'Fotos de la mercancía', fotos_cajas: 'Fotos de las cajas', otro: 'Otro' },
};

const ENTIDADES = { clientes: 'cliente', etiquetas: 'etiqueta' };

/** Tipo real por los bytes (no por el nombre ni por lo que declare el navegador). */
function tipoArchivo(buf, nombre) {
  const ini = (n) => buf.subarray(0, n);
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && ini(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.length > 4 && buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: '.pdf' };
  const ext = path.extname(String(nombre || '')).toLowerCase();
  // Office moderno es un ZIP; Office viejo, un archivo compuesto OLE.
  if (buf.length > 4 && ini(4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    if (ext === '.xlsx') return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext };
    if (ext === '.docx') return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext };
  }
  if (buf.length > 8 && ini(8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    if (ext === '.xls') return { mime: 'application/vnd.ms-excel', ext };
    if (ext === '.doc') return { mime: 'application/msword', ext };
  }
  return null;
}

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    entidad VARCHAR(10) NOT NULL,
    entidad_id INTEGER NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    nombre_original VARCHAR(255) NOT NULL,
    nombre_guardado VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    tamano INTEGER NOT NULL DEFAULT 0,
    almacen VARCHAR(10) NOT NULL DEFAULT 'disco',
    usuario_id INTEGER,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query('CREATE INDEX IF NOT EXISTS documentos_entidad_idx ON documentos(entidad, entidad_id)');
  try { await docs.asegurarBucket(); } catch (e) { console.error(e.message); }
}

/** Filas de documentos de un cliente (con los de sus etiquetas) o de unas etiquetas, para borrar sus archivos tras borrar las filas. */
async function documentosDe(db, { clienteId, etiquetaIds = [] }) {
  const ids = etiquetaIds.map(Number).filter(Number.isInteger);
  if (clienteId) {
    const r = await db.query('SELECT id FROM etiquetas WHERE cliente_id=$1', [clienteId]);
    ids.push(...r.rows.map((x) => Number(x.id)));
  }
  const filas = [];
  if (clienteId) filas.push(...(await db.query("SELECT id,almacen,nombre_guardado FROM documentos WHERE entidad='cliente' AND entidad_id=$1", [clienteId])).rows);
  if (ids.length) filas.push(...(await db.query("SELECT id,almacen,nombre_guardado FROM documentos WHERE entidad='etiqueta' AND entidad_id = ANY($1::int[])", [ids])).rows);
  return filas;
}

/** Borra filas y archivos. Nunca lanza: un archivo huérfano no debe frenar el borrado del cliente o la etiqueta. */
async function borrarDocumentos(db, filas) {
  if (!filas.length) return;
  try {
    await db.query('DELETE FROM documentos WHERE id = ANY($1::int[])', [filas.map((f) => Number(f.id))]);
    await docs.borrar(filas);
  } catch (e) {
    console.error('No se pudieron borrar los documentos:', e.message);
  }
}

function registrar(app, { db, auth, intId, logAction }) {
  const subir = multer({ storage: multer.memoryStorage(), limits: { files: 10, fileSize: MAX_BYTES } });
  const recibir = (req, res, next) => subir.array('archivos', 10)(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo puede pesar hasta 10 MB.' : err.code === 'LIMIT_FILE_COUNT' ? 'Máximo 10 archivos por envío.' : 'No se pudieron recibir los archivos.' }) : next()));

  /** Comprueba que el registro existe y que quien llama puede verlo. Devuelve { entidad, id, etiqueta } o null (ya respondió). */
  async function permitido(req, res, entidad, id) {
    if (!id) { res.status(400).json({ error: 'Identificador no válido' }); return null; }
    const sql = entidad === 'cliente'
      ? 'SELECT c.id,c.asesora_id,c.codigo_cliente AS nombre FROM clientes c WHERE c.id=$1'
      : 'SELECT e.id,c.asesora_id,e.numero AS nombre FROM etiquetas e LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=$1';
    const r = (await db.query(sql, [id])).rows[0];
    if (!r) { res.status(404).json({ error: entidad === 'cliente' ? 'Cliente no encontrado' : 'Etiqueta no encontrada' }); return null; }
    if (req.user.rol !== 'admin' && r.asesora_id !== req.user.id) { res.status(403).json({ error: 'No tienes permiso' }); return null; }
    return { entidad, id, nombre: r.nombre };
  }

  const salida = (d) => ({
    id: `d${d.id}`, tipo: d.tipo, tipoTexto: TIPOS[d.entidad]?.[d.tipo] || d.tipo, nombre: d.nombre_original, mime: d.mime_type,
    tamano: Number(d.tamano || 0), subidoPor: d.usuario_nombre || '', fecha: d.creado_en?.toISOString?.() || String(d.creado_en || ''),
  });

  app.get('/api/documentos/tipos', auth, (req, res) => res.json(TIPOS));

  for (const [ruta, entidad] of Object.entries(ENTIDADES)) {
    app.get(`/api/${ruta}/:id/documentos`, auth, async (req, res) => {
      try {
        const p = await permitido(req, res, entidad, intId(req.params.id));
        if (!p) return;
        const r = await db.query('SELECT d.*,u.nombre AS usuario_nombre FROM documentos d LEFT JOIN usuarios u ON u.id=d.usuario_id WHERE d.entidad=$1 AND d.entidad_id=$2 ORDER BY d.id DESC', [entidad, p.id]);
        res.json(r.rows.map(salida));
      } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar los documentos' }); }
    });

    app.post(`/api/${ruta}/:id/documentos`, auth, recibir, async (req, res) => {
      try {
        const p = await permitido(req, res, entidad, intId(req.params.id));
        if (!p) return;
        const tipo = String(req.body?.tipo || '');
        if (!TIPOS[entidad][tipo]) return res.status(400).json({ error: 'Elige el tipo de documento' });
        const archivos = Array.isArray(req.files) ? req.files : [];
        if (!archivos.length) return res.status(400).json({ error: 'Adjunta al menos un archivo' });
        let guardados = 0;
        const rechazados = [];
        for (const f of archivos) {
          // multer entrega el nombre como latin1: «cédula.pdf» llegaría como «cÃ©dula.pdf».
          const nombre = Buffer.from(String(f.originalname || 'archivo'), 'latin1').toString('utf8').slice(0, 255);
          const t = tipoArchivo(f.buffer, nombre);
          if (!t) { rechazados.push(nombre); continue; }
          const clave = `${entidad}-${p.id}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}${t.ext}`;
          const g = await docs.guardar(clave, f.buffer, t.mime);
          await db.query('INSERT INTO documentos(entidad,entidad_id,tipo,nombre_original,nombre_guardado,mime_type,tamano,almacen,usuario_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [entidad, p.id, tipo, nombre, g.clave, t.mime, f.size, g.almacen, req.user.id]);
          guardados++;
        }
        if (!guardados) return res.status(400).json({ error: 'Formato no admitido. Sube PDF, fotos (JPG, PNG, WEBP), Excel o Word.' });
        await logAction(req.user.id, `Documentos adjuntados a ${p.nombre}`, entidad === 'cliente' ? 'clientes' : 'etiquetas', p.id, `${guardados} archivo(s) de tipo ${TIPOS[entidad][tipo]}.`);
        res.status(201).json({ guardados, rechazados });
      } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron guardar los documentos' }); }
    });
  }

  /** Busca el documento y comprueba el permiso sobre el cliente o la etiqueta a la que pertenece. */
  async function documentoPermitido(req, res) {
    const id = Number(String(req.params.docId || '').replace(/^d/, ''));
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Documento no válido' }); return null; }
    const d = (await db.query('SELECT * FROM documentos WHERE id=$1', [id])).rows[0];
    if (!d) { res.status(404).json({ error: 'Documento no encontrado' }); return null; }
    const p = await permitido(req, res, d.entidad, d.entidad_id);
    return p ? { d, p } : null;
  }

  app.get('/api/documentos/:docId/archivo', auth, async (req, res) => {
    try {
      const x = await documentoPermitido(req, res);
      if (!x) return;
      const contenido = await docs.leer(x.d.almacen, x.d.nombre_guardado);
      if (!contenido) return res.status(404).json({ error: 'Archivo no encontrado' });
      // PDF e imágenes se abren en el navegador; Excel y Word se descargan.
      const enLinea = /^(image\/|application\/pdf)/.test(x.d.mime_type);
      res.setHeader('Content-Type', x.d.mime_type);
      res.setHeader('Content-Disposition', `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(x.d.nombre_original)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(contenido);
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo abrir el documento' }); }
  });

  app.delete('/api/documentos/:docId', auth, async (req, res) => {
    try {
      const x = await documentoPermitido(req, res);
      if (!x) return;
      await borrarDocumentos(db, [x.d]);
      await logAction(req.user.id, `Documento eliminado de ${x.p.nombre}`, x.d.entidad === 'cliente' ? 'clientes' : 'etiquetas', x.p.id, x.d.nombre_original);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo eliminar el documento' }); }
  });
}

module.exports = { ensureSchema, registrar, documentosDe, borrarDocumentos, TIPOS };
