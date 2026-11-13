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
  area: '1', // 1 = Caracas
  guias: '1',
  nota: '因英文翻译有差异供应商根据交货产品的实际箱数和实际名称自行修改，此标签贴上外',
};
const CLAVE = 'etiqueta_almacen';
const { leerCatalogo, CLAVE_AJUSTE } = require('./codigos');
const texto = (v, max) => String(v ?? '').trim().slice(0, max);

async function ensureSchema(db) {
  await db.query('CREATE TABLE IF NOT EXISTS ajustes (clave VARCHAR(80) PRIMARY KEY, valor TEXT, actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
}

async function leerEtiqueta(db) {
  try {
    const r = (await db.query('SELECT valor FROM ajustes WHERE clave=$1', [CLAVE])).rows[0];
    if (!r?.valor) return { ...ETIQUETA_POR_DEFECTO };
    const { negocio, ...guardado } = JSON.parse(r.valor); // «Negocio» (业务) ya no se usa: repetía el código del asesor
    return { ...ETIQUETA_POR_DEFECTO, ...guardado };
  } catch {
    return { ...ETIQUETA_POR_DEFECTO }; // sin la tabla (migración 20261113000000): los valores por defecto
  }
}

/** Lista del catálogo de códigos: [{ codigo, nombre }] con `largo` letras mayúsculas, sin repetidos. */
function listaCodigos(v, largo) {
  const vistos = new Set();
  return (Array.isArray(v) ? v : [])
    .map((x) => ({ codigo: texto(x?.codigo, largo).toUpperCase(), nombre: texto(x?.nombre, 60) }))
    .filter((x) => new RegExp(`^[A-Z]{${largo}}$`).test(x.codigo) && !vistos.has(x.codigo) && vistos.add(x.codigo))
    .slice(0, 40);
}

function registrar(app, { db, auth, logAction }) {
  // Catálogo del código de cliente (sedes, orígenes, tipos y valores por defecto): ver codigos.js.
  app.get('/api/ajustes/codigo-cliente', auth, async (req, res) => {
    res.json(await leerCatalogo(db));
  });

  app.put('/api/ajustes/codigo-cliente', auth, async (req, res) => {
    try {
      if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador cambia el catálogo de códigos' });
      const b = req.body || {};
      const datos = { sedes: listaCodigos(b.sedes, 2), origenes: listaCodigos(b.origenes, 2), tipos: listaCodigos(b.tipos, 1) };
      if (!datos.sedes.length || !datos.origenes.length || !datos.tipos.length) return res.status(400).json({ error: 'Debe haber al menos una sede, un origen y un tipo' });
      const elegir = (lista, v) => (lista.some((x) => x.codigo === String(v || '').toUpperCase()) ? String(v).toUpperCase() : lista[0].codigo);
      datos.defecto = { sede: elegir(datos.sedes, b.defecto?.sede), origen: elegir(datos.origenes, b.defecto?.origen), tipo: elegir(datos.tipos, b.defecto?.tipo) };
      const valor = JSON.stringify(datos);
      const upd = await db.query('UPDATE ajustes SET valor=$1, actualizado_en=CURRENT_TIMESTAMP WHERE clave=$2', [valor, CLAVE_AJUSTE]);
      if (!upd.rowCount) await db.query('INSERT INTO ajustes(clave,valor) VALUES($1,$2)', [CLAVE_AJUSTE, valor]);
      await logAction(req.user.id, 'Catálogo del código de cliente actualizado', 'ajustes', 0, `${datos.sedes.length} sede(s), ${datos.origenes.length} origen(es), ${datos.tipos.length} tipo(s).`);
      res.json(datos);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.code === '42P01' ? 'Falta aplicar la migración 20261113000000_costo_cliente_comision_base.sql' : 'No se pudo guardar el catálogo' });
    }
  });

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
      const datos = { responsables, direccion: texto(b.direccion, 300), area: texto(b.area, 30), guias: texto(b.guias, 10) || '1', nota: texto(b.nota, 400) };
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
