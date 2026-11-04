/**
 * «Pídelo de China»: encargos desde la web pública. El cliente describe lo que busca, pega enlaces (1688, Alibaba,
 * Taobao…) y/o sube fotos; llega al panel como una solicitud de tipo «encargo». El equipo lo revisa con el importador
 * (búsqueda, Apify, IA), calcula el precio real con el contenedor disponible y responde con la cotización.
 * Nada se busca ni se cobra en vivo por cada visitante: el gasto de Apify/IA solo ocurre cuando el equipo decide.
 *
 *   POST /api/web/encargos                         → multipart: nombre, telefono, email, estado, descripcion, enlaces,
 *                                                    cantidad, fotos (hasta 3) y el campo trampa sitioWeb
 *   GET  /api/web/solicitudes/:id/fotos/:fotoId     → foto de un encargo (solo administrador)
 */
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const almacen = require('./almacen');

const fotos = almacen.crearAlmacen({ bucket: process.env.SUPABASE_BUCKET_TIENDA || 'tienda', carpetaDisco: path.join(__dirname, 'uploads', 'encargos') });
const MAX_FOTOS = 3;
// Vercel no acepta cuerpos de más de ~4,5 MB: la web comprime las fotos antes de enviarlas.
const subir = multer({ storage: multer.memoryStorage(), limits: { files: MAX_FOTOS, fileSize: 4 * 1024 * 1024, fields: 20 } });

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
/** «ENC-0005»: número de la solicitud, el mismo en la web del cliente y en el panel. */
const codigoEncargo = (id) => `ENC-${String(id).padStart(4, '0')}`;

function tipoImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  return null;
}

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS web_solicitud_fotos (
    id SERIAL PRIMARY KEY,
    solicitud_id INTEGER NOT NULL,
    nombre_guardado VARCHAR(255) NOT NULL,
    mime_type VARCHAR(60) NOT NULL,
    almacen VARCHAR(10) NOT NULL DEFAULT 'disco',
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query('CREATE INDEX IF NOT EXISTS web_solicitud_fotos_solicitud_idx ON web_solicitud_fotos(solicitud_id)');
}

/** Enlaces http(s) de un texto (uno por línea, separados por espacios o comas). */
function enlacesDe(v) {
  return [...new Set(String(v ?? '').split(/[\s,]+/).map((u) => u.trim()).filter((u) => /^https?:\/\/[^\s<>"']{4,}$/i.test(u)).map((u) => u.slice(0, 600)))].slice(0, 5);
}

function registrar(app, { db, auth, intId }) {
  const limite = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados encargos seguidos. Intenta de nuevo en unos minutos.' } });

  app.post('/api/web/encargos', limite, (req, res, next) => subir.array('fotos', MAX_FOTOS)(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada foto debe pesar menos de 4 MB' : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_FOTOS} fotos` : 'No se pudo recibir el encargo' }) : next())), async (req, res) => {
    try {
      const b = req.body || {};
      if (texto(b.sitioWeb, 200)) return res.status(201).json({ ok: true }); // trampa para bots
      const nombre = texto(b.nombre, 150);
      const telefono = texto(b.telefono, 50).replace(/[^\d+\-\s()]/g, '');
      const email = texto(b.email, 150).toLowerCase();
      const descripcion = texto(b.descripcion, 2000);
      const enlaces = enlacesDe(b.enlaces);
      const cantidad = texto(b.cantidad, 60);
      const imagenes = (req.files || []).map((f) => ({ f, t: tipoImagen(f.buffer) })).filter((x) => x.t);
      if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre' });
      if (!telefono && !email) return res.status(400).json({ error: 'Déjanos un teléfono (WhatsApp) o un correo para enviarte la cotización' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'El correo no es válido' });
      if (!descripcion && !enlaces.length && !imagenes.length) return res.status(400).json({ error: 'Cuéntanos qué producto buscas, pega un enlace o sube una foto' });
      if ((req.files || []).length && !imagenes.length) return res.status(400).json({ error: 'Las fotos deben ser JPG, PNG o WEBP' });

      const datos = JSON.stringify({ enlaces, cantidad });
      let id;
      let conFotos = true;
      try {
        id = (await db.query('INSERT INTO web_solicitudes(tipo,nombre,telefono,email,estado_venezuela,mensaje,datos) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['encargo', nombre, telefono || null, email || null, texto(b.estado, 80) || null, descripcion || null, datos])).rows[0].id;
      } catch (e) {
        // Sin la migración 20261105000000_encargos.sql, la base aún no acepta el tipo «encargo»: se guarda como contacto
        // con la marca [Encargo] para no perder al cliente. Las fotos no se suben: tampoco existe su tabla.
        if (e.code !== '23514') throw e;
        console.error('Encargo guardado como contacto: falta la migración 20261105000000_encargos.sql');
        conFotos = false;
        id = (await db.query('INSERT INTO web_solicitudes(tipo,nombre,telefono,email,estado_venezuela,mensaje,datos) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['contacto', nombre, telefono || null, email || null, texto(b.estado, 80) || null, `[Encargo] ${descripcion}${enlaces.length ? `\n${enlaces.join('\n')}` : ''}${cantidad ? `\nCantidad: ${cantidad}` : ''}${imagenes.length ? `\n(Envió ${imagenes.length} foto(s): pídeselas por WhatsApp)` : ''}`, null])).rows[0].id;
      }

      let guardadas = 0;
      for (const { f, t } of conFotos ? imagenes : []) {
        try {
          const g = await fotos.guardar(`encargos/s${id}/${Date.now()}_${crypto.randomBytes(4).toString('hex')}${t.ext}`, f.buffer, t.mime);
          await db.query('INSERT INTO web_solicitud_fotos(solicitud_id,nombre_guardado,mime_type,almacen) VALUES($1,$2,$3,$4)', [id, g.clave, t.mime, g.almacen]);
          guardadas++;
        } catch (e) { console.error('Foto de encargo no guardada:', e.message); }
      }
      // Código que ve el cliente en su «Orden de encargo» y el equipo en el panel.
      res.status(201).json({ ok: true, fotos: guardadas, codigo: codigoEncargo(id) });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo enviar tu encargo' });
    }
  });

  app.get('/api/web/solicitudes/:id/fotos/:fotoId', auth, async (req, res) => {
    try {
      if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador' });
      const f = (await db.query('SELECT nombre_guardado,mime_type,almacen FROM web_solicitud_fotos WHERE id=$1 AND solicitud_id=$2', [intId(req.params.fotoId), intId(req.params.id)])).rows[0];
      const contenido = f && (await fotos.leer(f.almacen, f.nombre_guardado));
      if (!contenido) return res.status(404).json({ error: 'Foto no encontrada' });
      res.setHeader('Content-Type', f.mime_type);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.send(contenido);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la foto' });
    }
  });
}

/** Fotos de las solicitudes dadas (para la lista del panel). Si falta la tabla (sin migración), ninguna. */
async function fotosDe(db, ids) {
  if (!ids.length) return [];
  try {
    return (await db.query('SELECT id, solicitud_id FROM web_solicitud_fotos WHERE solicitud_id = ANY($1::int[]) ORDER BY id', [ids])).rows;
  } catch { return []; }
}

module.exports = { ensureSchema, registrar, fotosDe, enlacesDe, codigoEncargo };
