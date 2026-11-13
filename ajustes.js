/**
 * Ajustes que cambia el administrador. Por ahora: los datos fijos de la etiqueta del almacén de Yiwu (la imagen PNG que
 * la asesora le manda al cliente para que el proveedor la pegue en las cajas).
 *
 *   GET /api/ajustes/etiqueta-almacen   → datos fijos (cualquier usuario del panel; los usa para dibujar la etiqueta)
 *   PUT /api/ajustes/etiqueta-almacen   → los cambia (solo administrador)
 */

/** Valores por defecto: los de la etiqueta que usa hoy el almacén. */
const ETIQUETA_POR_DEFECTO = {
  responsables: [
    { nombre: '刘生', telefono: '19858987879' },
    { nombre: '何生', telefono: '15355319599' },
    { nombre: '余生', telefono: '13432299909' },
  ],
  direccion: '浙江省义乌市福田宗宅5区15栋1单元，导航（顺风外贸部）',
  area: '2-0',
  negocio: '2-24',
  guias: '1',
  nota: '因英文翻译有差异供应商根据交货产品的实际箱数和实际名称自行修改，此标签贴上外',
};
const CLAVE = 'etiqueta_almacen';
const texto = (v, max) => String(v ?? '').trim().slice(0, max);

async function ensureSchema(db) {
  await db.query('CREATE TABLE IF NOT EXISTS ajustes (clave VARCHAR(80) PRIMARY KEY, valor TEXT, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

async function leerEtiqueta(db) {
  try {
    const r = (await db.query('SELECT valor FROM ajustes WHERE clave=$1', [CLAVE])).rows[0];
    return r?.valor ? { ...ETIQUETA_POR_DEFECTO, ...JSON.parse(r.valor) } : { ...ETIQUETA_POR_DEFECTO };
  } catch {
    return { ...ETIQUETA_POR_DEFECTO }; // sin la tabla (migración 20261113000000): los valores por defecto
  }
}

function registrar(app, { db, auth, logAction }) {
  app.get('/api/ajustes/etiqueta-almacen', auth, async (req, res) => {
    res.json(await leerEtiqueta(db));
  });

  app.put('/api/ajustes/etiqueta-almacen', auth, async (req, res) => {
    try {
      if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador cambia los datos de la etiqueta' });
      const b = req.body || {};
      const responsables = (Array.isArray(b.responsables) ? b.responsables : [])
        .map((x) => ({ nombre: texto(x?.nombre, 40), telefono: texto(x?.telefono, 30) }))
        .filter((x) => x.nombre || x.telefono)
        .slice(0, 6);
      const datos = { responsables, direccion: texto(b.direccion, 300), area: texto(b.area, 30), negocio: texto(b.negocio, 30), guias: texto(b.guias, 10) || '1', nota: texto(b.nota, 400) };
      if (!datos.direccion) return res.status(400).json({ error: 'La dirección del almacén es obligatoria' });
      const valor = JSON.stringify(datos);
      const upd = await db.query('UPDATE ajustes SET valor=$1, actualizado_en=CURRENT_TIMESTAMP WHERE clave=$2', [valor, CLAVE]);
      if (!upd.rowCount) await db.query('INSERT INTO ajustes(clave,valor) VALUES($1,$2)', [CLAVE, valor]);
      await logAction(req.user.id, 'Datos de la etiqueta del almacén actualizados', 'ajustes', 0, `${responsables.length} responsable(s).`);
      res.json(datos);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.code === '42P01' ? 'Falta aplicar la migración 20261113000000_costo_cliente_comision_base.sql' : 'No se pudieron guardar los datos' });
    }
  });
}

module.exports = { ensureSchema, registrar, ETIQUETA_POR_DEFECTO };
