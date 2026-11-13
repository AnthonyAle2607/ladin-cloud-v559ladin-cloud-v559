/**
 * Contactos por asignar (solo administrador): clientes del sistema anterior con solo nombre y teléfono. El administrador
 * elige la asesora de cada uno; al asignarlo se crea como cliente de esa asesora (código correlativo CC-###).
 *
 *   GET    /api/contactos?estado=pendiente|asignado|descartado|todos
 *   POST   /api/contactos/cargar    { contactos: [{ nombre, apellido, telefono }] }   (el panel los saca del archivo)
 *   POST   /api/contactos/asignar   { ids: ['k1', …], advisorId: 'u3' }
 *   PUT    /api/contactos/:id       { estado: 'descartado' | 'pendiente' }
 *
 * No se guarda ningún otro dato del sistema anterior (ni código, ni asesora vieja, ni documentos).
 */
const { asignarCodigoCliente } = require('./codigos');

const MAX_CARGA = 5000;
const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Teléfono comparable: solo dígitos, últimos 10 (0424-1234567, 58 424 1234567 y 4241234567 son el mismo). */
const telNorm = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-10) : null; };
/** Nombre comparable: minúsculas, sin acentos ni signos, espacios simples. */
const nomNorm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/s+/g, ' ').trim();
const primerNombre = (t) => nomNorm(t).split(' ')[0] || '';
/** Misma persona = mismo teléfono y mismo nombre completo (dos personas pueden compartir un teléfono). */
const claveDe = (nombre, apellido, tel) => `${telNorm(tel) || ''}|${nomNorm(`${nombre} ${apellido || ''}`)}`.slice(0, 220);
const FALTA = 'Falta aplicar la migración 20261114000000_contactos_por_asignar.sql';

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS contactos_por_asignar (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    apellido VARCHAR(150),
    telefono VARCHAR(50),
    telefono_norm VARCHAR(20),
    clave VARCHAR(220),
    origen VARCHAR(40) NOT NULL DEFAULT 'ladincloud',
    estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    cliente_id INTEGER,
    asesora_id INTEGER,
    asignado_por INTEGER,
    asignado_en TIMESTAMP,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query('CREATE UNIQUE INDEX IF NOT EXISTS contactos_por_asignar_clave_idx ON contactos_por_asignar(clave)');
}

function registrar(app, { db, auth, intId, logAction }) {
  const soloAdmin = (req, res, next) => (req.user?.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador' }));
  const fallo = (res, e, msg) => { console.error(e); res.status(500).json({ error: e.code === '42P01' ? FALTA : msg }); };

  /**
   * Clientes que ya existen, para no duplicarlos: con teléfono, mismo teléfono y mismo primer nombre; sin teléfono, mismo
   * nombre completo. Devuelve una función que dice si un contacto ya es cliente (y cuál).
   */
  async function clientesExistentes() {
    const r = await db.query('SELECT c.id, c.nombre, c.apellido, c.telefono, c.codigo_cliente, u.nombre AS asesora FROM clientes c LEFT JOIN usuarios u ON u.id=c.asesora_id');
    const m = new Map();
    const poner = (k, c) => { if (!m.has(k)) m.set(k, c); };
    const llaves = (nombre, apellido, tel) => { const t = telNorm(tel); return t ? [`t:${t}|${primerNombre(nombre)}`] : [`n:${nomNorm(`${nombre} ${apellido || ''}`)}`]; };
    for (const c of r.rows) {
      const t = telNorm(c.telefono);
      if (t) poner(`t:${t}|${primerNombre(c.nombre)}`, c);
      poner(`n:${nomNorm(`${c.nombre} ${c.apellido || ''}`)}`, c);
    }
    return {
      buscar: (nombre, apellido, tel) => llaves(nombre, apellido, tel).map((k) => m.get(k)).find(Boolean) || null,
      agregar: (nombre, apellido, tel, c) => { llaves(nombre, apellido, tel).forEach((k) => poner(k, c)); poner(`n:${nomNorm(`${nombre} ${apellido || ''}`)}`, c); },
    };
  }

  app.get('/api/contactos', auth, soloAdmin, async (req, res) => {
    try {
      const estado = ['pendiente', 'asignado', 'descartado'].includes(req.query.estado) ? req.query.estado : req.query.estado === 'todos' ? null : 'pendiente';
      const r = await db.query(
        `SELECT k.*, c.codigo_cliente, u.nombre AS asesora_nombre FROM contactos_por_asignar k
         LEFT JOIN clientes c ON c.id=k.cliente_id LEFT JOIN usuarios u ON u.id=k.asesora_id
         ${estado ? 'WHERE k.estado=$1' : ''} ORDER BY k.nombre, k.apellido, k.id`, estado ? [estado] : []);
      const conteo = await db.query('SELECT estado, COUNT(*) AS n FROM contactos_por_asignar GROUP BY estado');
      res.json({
        totales: Object.fromEntries(conteo.rows.map((x) => [x.estado, Number(x.n)])),
        contactos: r.rows.map((k) => ({
          id: `k${k.id}`, nombre: k.nombre, apellido: k.apellido || '', telefono: k.telefono || '', estado: k.estado,
          clienteId: k.cliente_id ? `c${k.cliente_id}` : '', clienteCodigo: k.codigo_cliente || '',
          asesoraId: k.asesora_id ? `u${k.asesora_id}` : '', asesoraNombre: k.asesora_nombre || '', asignadoEn: k.asignado_en,
        })),
      });
    } catch (e) { fallo(res, e, 'No se pudieron leer los contactos'); }
  });

  app.post('/api/contactos/cargar', auth, soloAdmin, async (req, res) => {
    try {
      const lista = Array.isArray(req.body?.contactos) ? req.body.contactos : [];
      if (!lista.length) return res.status(400).json({ error: 'El archivo no trae contactos' });
      if (lista.length > MAX_CARGA) return res.status(400).json({ error: `Máximo ${MAX_CARGA} contactos por carga` });
      const clientes = await clientesExistentes();
      const ya = new Set((await db.query('SELECT clave FROM contactos_por_asignar WHERE clave IS NOT NULL')).rows.map((x) => x.clave));
      const r = { creados: 0, repetidos: 0, yaClientes: 0, sinNombre: 0 };
      for (const x of lista) {
        const nombre = texto(x?.nombre, 150), apellido = texto(x?.apellido, 150) || null, telefono = texto(x?.telefono, 50) || null;
        if (!nombre) { r.sinNombre++; continue; }
        const clave = claveDe(nombre, apellido, telefono);
        if (clientes.buscar(nombre, apellido, telefono)) { r.yaClientes++; continue; }
        if (ya.has(clave)) { r.repetidos++; continue; }
        await db.query('INSERT INTO contactos_por_asignar(nombre,apellido,telefono,telefono_norm,clave) VALUES($1,$2,$3,$4,$5)', [nombre, apellido, telefono, telNorm(telefono), clave]);
        ya.add(clave);
        r.creados++;
      }
      await logAction(req.user.id, 'Contactos por asignar cargados', 'contactos_por_asignar', 0, `${r.creados} nuevo(s), ${r.repetidos} repetido(s), ${r.yaClientes} ya eran clientes.`);
      res.json(r);
    } catch (e) { fallo(res, e, 'No se pudieron cargar los contactos'); }
  });

  app.post('/api/contactos/asignar', auth, soloAdmin, async (req, res) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map((v) => intId(v)).filter(Boolean).slice(0, 1000);
      const asesoraId = intId(req.body?.advisorId);
      if (!ids.length) return res.status(400).json({ error: 'Elige al menos un contacto' });
      const asesora = (await db.query("SELECT id, nombre FROM usuarios WHERE id=$1 AND rol='asesora' AND activo", [asesoraId])).rows[0];
      if (!asesora) return res.status(400).json({ error: 'Elige una asesora activa' });
      const clientes = await clientesExistentes();
      const r = { asignados: 0, yaClientes: [], omitidos: 0 };
      for (const id of ids) {
        const k = (await db.query("SELECT * FROM contactos_por_asignar WHERE id=$1 AND estado='pendiente'", [id])).rows[0];
        if (!k) { r.omitidos++; continue; }
        const existente = clientes.buscar(k.nombre, k.apellido, k.telefono);
        if (existente) { await db.query("UPDATE contactos_por_asignar SET estado='asignado', cliente_id=$1, asesora_id=(SELECT asesora_id FROM clientes WHERE id=$1), asignado_por=$2, asignado_en=CURRENT_TIMESTAMP WHERE id=$3", [existente.id, req.user.id, id]); r.yaClientes.push(`${k.nombre} (${existente.codigo_cliente}${existente.asesora ? `, ${existente.asesora}` : ''})`); continue; }
        // Se marca primero el contacto (si otra persona lo asignó a la vez, no se duplica el cliente).
        const tomado = await db.query("UPDATE contactos_por_asignar SET estado='asignado', asesora_id=$1, asignado_por=$2, asignado_en=CURRENT_TIMESTAMP WHERE id=$3 AND estado='pendiente'", [asesora.id, req.user.id, id]);
        if (!tomado.rowCount) { r.omitidos++; continue; }
        try {
          const c = (await db.query("INSERT INTO clientes(nombre,apellido,telefono,asesora_id,estado) VALUES($1,$2,$3,$4,'pending') RETURNING id", [k.nombre, k.apellido, k.telefono, asesora.id])).rows[0];
          const codigo = await asignarCodigoCliente(db, c.id);
          await db.query('UPDATE contactos_por_asignar SET cliente_id=$1 WHERE id=$2', [c.id, id]);
          clientes.agregar(k.nombre, k.apellido, k.telefono, { id: c.id, codigo_cliente: codigo, asesora: asesora.nombre });
          await logAction(req.user.id, `Cliente ${codigo} creado desde contactos por asignar`, 'clientes', c.id, `${k.nombre}${k.apellido ? ` ${k.apellido}` : ''} asignado a ${asesora.nombre}.`);
          r.asignados++;
        } catch (e) {
          await db.query("UPDATE contactos_por_asignar SET estado='pendiente', asesora_id=NULL, asignado_por=NULL, asignado_en=NULL WHERE id=$1", [id]);
          throw e;
        }
      }
      res.json(r);
    } catch (e) { fallo(res, e, 'No se pudieron asignar los contactos'); }
  });

  app.put('/api/contactos/:id', auth, soloAdmin, async (req, res) => {
    try {
      const estado = req.body?.estado;
      if (!['descartado', 'pendiente'].includes(estado)) return res.status(400).json({ error: 'Estado no válido' });
      const r = await db.query(`UPDATE contactos_por_asignar SET estado=$1 WHERE id=$2 AND estado=$3`, [estado, intId(req.params.id), estado === 'descartado' ? 'pendiente' : 'descartado']);
      if (!r.rowCount) return res.status(404).json({ error: 'Contacto no encontrado o ya asignado' });
      res.json({ ok: true });
    } catch (e) { fallo(res, e, 'No se pudo actualizar el contacto'); }
  });
}

module.exports = { ensureSchema, registrar, telNorm };
