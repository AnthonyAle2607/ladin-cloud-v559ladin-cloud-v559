/**
 * Packing lists que sube el CLIENTE desde la app móvil. La IA es el filtro: revisa que el archivo sea un packing list
 * y lee sus datos (cajas, CBM, mercancía, proveedor). En el panel nadie usa la IA: la asesora llena la etiqueta a mano
 * y compara con lo que leyó la IA del packing list del cliente («la IA corrige al que no sabe»).
 *
 * App (sesión de cliente):
 *   POST /api/app/packing                   → multipart `archivo` (foto o Excel/CSV) y `etiquetaId` opcional
 *   GET  /api/app/packing                   → los packing lists que envió el cliente
 * Panel (administrador o asesora del cliente):
 *   GET  /api/packing-clientes?etiqueta=&pendientes=1&cliente=   → lista
 *   GET  /api/packing-clientes/:id/archivo  → el archivo
 *   PUT  /api/packing-clientes/:id          → { etiquetaId } vincular (o null para desvincular) · { estado: 'descartado' | 'recibido' }
 */
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const almacen = require('./almacen');
const ia = require('./packing-ia');

const archivos = almacen.crearAlmacen({ bucket: process.env.SUPABASE_BUCKET_DOCUMENTOS || 'documentos', carpetaDisco: path.join(__dirname, 'uploads', 'packing-clientes') });
// Vercel no acepta cuerpos de más de ~4,5 MB: la app reduce las fotos antes de enviarlas.
const subir = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 4 * 1024 * 1024 } });
const ESTADOS = ['recibido', 'descartado'];

const MENSAJE_NO_ES = 'Este archivo no parece un packing list. Envía la lista de empaque que te dio el proveedor (la que trae las cajas, pesos y medidas).';

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS packing_clientes (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER NOT NULL,
    etiqueta_id INTEGER,
    nombre_original VARCHAR(255),
    nombre_guardado VARCHAR(255) NOT NULL,
    mime_type VARCHAR(120),
    tamano INTEGER NOT NULL DEFAULT 0,
    almacen VARCHAR(10) NOT NULL DEFAULT 'disco',
    revisado BOOLEAN NOT NULL DEFAULT FALSE,
    datos TEXT,
    estado VARCHAR(20) NOT NULL DEFAULT 'recibido',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query('CREATE INDEX IF NOT EXISTS packing_clientes_cliente_idx ON packing_clientes(cliente_id)');
  await db.query('CREATE INDEX IF NOT EXISTS packing_clientes_etiqueta_idx ON packing_clientes(etiqueta_id)');
}

/** Tipo por los bytes: fotos JPG/PNG/WEBP; Excel/CSV por la extensión (la IA solo lee esos formatos). */
function tipoDe(buf, nombre) {
  const img = ia.tipoDeImagen(buf);
  if (img) return { mime: img, ext: img === 'image/jpeg' ? '.jpg' : img === 'image/png' ? '.png' : '.webp' };
  const m = String(nombre || '').toLowerCase().match(/\.(xlsx|xls|csv)$/);
  if (!m) return null;
  return { mime: m[1] === 'csv' ? 'text/csv' : m[1] === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: `.${m[1]}` };
}

const leerJSON = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };

function salida(r) {
  const d = leerJSON(r.datos) || {};
  return {
    id: String(r.id),
    fecha: r.creado_en?.toISOString?.() || String(r.creado_en || ''),
    clienteId: `c${r.cliente_id}`,
    clienteCodigo: r.codigo_cliente || '',
    clienteNombre: [r.cliente_nombre, r.cliente_apellido].filter(Boolean).join(' '),
    etiquetaId: r.etiqueta_id ? `l${r.etiqueta_id}` : '',
    etiquetaNumero: r.etiqueta_numero || '',
    nombre: r.nombre_original || 'packing list',
    mime: r.mime_type || '',
    revisado: !!r.revisado,
    estado: r.estado,
    // Lo que leyó la IA (null si no se pudo revisar)
    datos: r.revisado ? { cajas: d.cajas ?? null, cbm: d.cbm ?? null, mercancia: d.mercancia || '', proveedor: d.proveedor || '', numeroDocumento: d.numeroDocumento || '', fechaDocumento: d.fecha || '', pesoBrutoKg: d.pesoBrutoKg ?? null, avisos: d.avisos || [] } : null,
    motivo: d.motivo || '',
  };
}

const SELECT = `SELECT p.*, c.codigo_cliente, c.nombre AS cliente_nombre, c.apellido AS cliente_apellido, c.asesora_id, e.numero AS etiqueta_numero
  FROM packing_clientes p JOIN clientes c ON c.id=p.cliente_id LEFT JOIN etiquetas e ON e.id=p.etiqueta_id`;

function registrar(app, { db, auth, intId, logAction, authCliente }) {
  // Límite por cliente (authCliente va antes, así que siempre hay cliente).
  const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => `pk-${req.cliente.id}`, message: { error: 'Enviaste muchos archivos seguidos. Intenta de nuevo en unos minutos.' } });
  const recibir = (req, res, next) => subir.single('archivo')(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 4 MB. Toma la foto de nuevo o envía el Excel.' : 'No se pudo recibir el archivo.' }) : next()));

  /* ----- app del cliente ----- */

  app.post('/api/app/packing', authCliente, limite, recibir, async (req, res) => {
    try {
      const f = req.file;
      if (!f) return res.status(400).json({ error: 'Adjunta la foto o el Excel del packing list.' });
      const nombre = Buffer.from(String(f.originalname || 'packing'), 'latin1').toString('utf8').slice(0, 255);
      const t = tipoDe(f.buffer, nombre);
      if (!t) return res.status(400).json({ error: 'Envía una foto (JPG o PNG) o el Excel del packing list. Si lo tienes en PDF, tómale una foto o captura.' });
      let etiquetaId = null;
      if (req.body?.etiquetaId) {
        etiquetaId = intId(req.body.etiquetaId);
        const e = (await db.query('SELECT id FROM etiquetas WHERE id=$1 AND cliente_id=$2', [etiquetaId, req.cliente.id])).rows[0];
        if (!e) return res.status(404).json({ error: 'Esa etiqueta no es tuya o ya no existe.' });
      }

      // Filtro con IA: si no es un packing list no se guarda. Si la IA no está o no responde, se guarda sin revisar
      // (la asesora lo revisa a mano) para no perder lo que envió el cliente.
      let revisado = false;
      let datos = {};
      const cfg = ia.configuracion();
      if (cfg.url && cfg.modelo) {
        try {
          // El cliente espera la respuesta en el teléfono: primero los modelos rápidos («lite»), luego los demás y al
          // final el primero de la lista (el más preciso, pero el más lento), por si los otros están saturados.
          const lite = cfg.modelos.filter((m) => /lite/i.test(m));
          const resto = cfg.modelos.filter((m) => !/lite/i.test(m));
          const modelos = [...lite, ...resto.slice(1), ...resto.slice(0, 1)];
          const r = await ia.leerPackingList(f.buffer, nombre, { ...cfg, modelos, modelo: modelos[0] });
          if (!r.datos.esPackingList) return res.status(422).json({ error: MENSAJE_NO_ES, noEsPackingList: true });
          revisado = true;
          datos = { cajas: r.sugerido.cajas, cbm: r.sugerido.cbm, mercancia: r.sugerido.mercancia, pesoBrutoKg: r.sugerido.pesoBrutoKg, proveedor: r.datos.proveedor, numeroDocumento: r.datos.numeroDocumento, fecha: r.datos.fecha, avisos: r.avisos.slice(0, 8) };
        } catch (e) {
          console.error('Packing list del cliente sin revisar:', e.message);
          datos = { motivo: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'La IA no respondió a tiempo' : 'La IA no pudo leerlo' };
        }
      } else datos = { motivo: 'La IA no está configurada' };

      const clave = `packing-clientes/c${req.cliente.id}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}${t.ext}`;
      const g = await archivos.guardar(clave, f.buffer, t.mime);
      const id = (await db.query('INSERT INTO packing_clientes(cliente_id,etiqueta_id,nombre_original,nombre_guardado,mime_type,tamano,almacen,revisado,datos) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
        [req.cliente.id, etiquetaId, nombre, g.clave, t.mime, f.size, g.almacen, revisado, JSON.stringify(datos)])).rows[0].id;
      await logAction(null, `Packing list del cliente ${req.cliente.codigo_cliente || req.cliente.id}`, 'packing_clientes', id, revisado ? `Leído por la IA: ${datos.cajas ?? '?'} cajas · ${datos.cbm ?? '?'} CBM.` : `Sin revisar (${datos.motivo}).`).catch(() => {});
      const r = (await db.query(`${SELECT} WHERE p.id=$1`, [id])).rows[0];
      res.status(201).json(salida(r));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo enviar el packing list. Intenta de nuevo.' });
    }
  });

  app.get('/api/app/packing', authCliente, async (req, res) => {
    try {
      const r = await db.query(`${SELECT} WHERE p.cliente_id=$1 AND p.estado<>'descartado' ORDER BY p.id DESC LIMIT 50`, [req.cliente.id]);
      res.json(r.rows.map(salida));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar tus packing lists' });
    }
  });

  /* ----- panel ----- */

  /** El administrador ve todo; la asesora, solo lo de sus clientes. */
  const permitido = (req, fila) => req.user.rol === 'admin' || Number(fila.asesora_id) === Number(req.user.id);

  app.get('/api/packing-clientes', auth, async (req, res) => {
    try {
      const donde = [];
      const params = [];
      if (req.user.rol !== 'admin') { params.push(req.user.id); donde.push(`c.asesora_id=$${params.length}`); }
      if (req.query.etiqueta) { params.push(intId(req.query.etiqueta)); donde.push(`p.etiqueta_id=$${params.length}`); }
      if (req.query.cliente) { params.push(intId(req.query.cliente)); donde.push(`p.cliente_id=$${params.length}`); }
      if (req.query.pendientes) donde.push("p.etiqueta_id IS NULL AND p.estado='recibido'");
      const r = await db.query(`${SELECT} ${donde.length ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY p.id DESC LIMIT 300`, params);
      res.json(r.rows.map(salida));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudieron cargar los packing lists de los clientes' });
    }
  });

  app.get('/api/packing-clientes/:id/archivo', auth, async (req, res) => {
    try {
      const r = (await db.query(`${SELECT} WHERE p.id=$1`, [intId(req.params.id)])).rows[0];
      if (!r || !permitido(req, r)) return res.status(404).json({ error: 'Archivo no encontrado' });
      const contenido = await archivos.leer(r.almacen, r.nombre_guardado);
      if (!contenido) return res.status(404).json({ error: 'Archivo no encontrado' });
      res.setHeader('Content-Type', r.mime_type || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.nombre_original || 'packing')}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(contenido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo abrir el archivo' });
    }
  });

  app.put('/api/packing-clientes/:id', auth, async (req, res) => {
    try {
      const id = intId(req.params.id);
      const r = (await db.query(`${SELECT} WHERE p.id=$1`, [id])).rows[0];
      if (!r || !permitido(req, r)) return res.status(404).json({ error: 'Packing list no encontrado' });
      const b = req.body || {};
      if (Object.prototype.hasOwnProperty.call(b, 'etiquetaId')) {
        const etq = b.etiquetaId ? intId(b.etiquetaId) : null;
        if (etq && !(await db.query('SELECT id FROM etiquetas WHERE id=$1 AND cliente_id=$2', [etq, r.cliente_id])).rows.length) return res.status(400).json({ error: 'La etiqueta debe ser de este mismo cliente' });
        await db.query("UPDATE packing_clientes SET etiqueta_id=$1, estado='recibido' WHERE id=$2", [etq, id]);
      }
      if (b.estado !== undefined) {
        if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'Estado no válido' });
        await db.query('UPDATE packing_clientes SET estado=$1 WHERE id=$2', [b.estado, id]);
      }
      await logAction(req.user.id, `Packing list del cliente ${r.codigo_cliente || r.cliente_id} actualizado`, 'packing_clientes', id, b.estado === 'descartado' ? 'Descartado.' : b.etiquetaId ? 'Vinculado a una etiqueta.' : 'Actualizado.');
      res.json(salida((await db.query(`${SELECT} WHERE p.id=$1`, [id])).rows[0]));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo actualizar el packing list' });
    }
  });
}

module.exports = { ensureSchema, registrar, MENSAJE_NO_ES };
