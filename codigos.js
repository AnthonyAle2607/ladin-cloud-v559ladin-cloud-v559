/**
 * Código de cliente: [SEDE][ORIGEN]-[TIPO]-[CORRELATIVO], por ejemplo CCMI-G-0015.
 *   - Sede (2 letras): dónde se registró el cliente (CC Caracas, VL Valencia, MC Maracaibo, BQ Barquisimeto…).
 *   - Origen (2 letras): de dónde viene la carga (MI Miami, PN Panamá, CN China, ES España, CL Colombia).
 *   - Tipo (1 letra): G general, T tecnología, I industrial, A alimentos, M medicamentos.
 *   - Correlativo (4 dígitos): ÚNICO para todos los clientes, sin importar sede, origen o tipo (0001, 0002…; luego 10000).
 * El catálogo (sedes, orígenes, tipos y los valores por defecto) lo cambia el administrador: ajustes.codigo_cliente.
 * Si al crear el cliente se escribe un código a mano, se respeta; si se deja vacío, lo arma el sistema.
 */
const PATRON = /^([A-Z]{2})([A-Z]{2})-([A-Z])-(\d{4,9})$/;
const CLAVE_AJUSTE = 'codigo_cliente';

const CATALOGO_POR_DEFECTO = {
  sedes: [
    { codigo: 'CC', nombre: 'Caracas' },
    { codigo: 'VL', nombre: 'Valencia' },
    { codigo: 'MC', nombre: 'Maracaibo' },
    { codigo: 'BQ', nombre: 'Barquisimeto' },
  ],
  origenes: [
    { codigo: 'MI', nombre: 'Miami (EE. UU.)' },
    { codigo: 'PN', nombre: 'Panamá' },
    { codigo: 'CN', nombre: 'China' },
    { codigo: 'ES', nombre: 'España' },
    { codigo: 'CL', nombre: 'Colombia' },
  ],
  tipos: [
    { codigo: 'G', nombre: 'Carga general' },
    { codigo: 'T', nombre: 'Tecnología y electrónica' },
    { codigo: 'I', nombre: 'Industrial' },
    { codigo: 'A', nombre: 'Alimentos / perecederos' },
    { codigo: 'M', nombre: 'Medicamentos y farmacia' },
  ],
  defecto: { sede: 'CC', origen: 'CN', tipo: 'G' },
};

const formatoNumero = (n) => String(n).padStart(4, '0');
const armarCodigo = ({ sede, origen, tipo }, numero) => `${sede}${origen}-${tipo}-${formatoNumero(numero)}`;
/** Partes de un código con la nomenclatura, o null si no la sigue. */
function partesDeCodigo(codigo) {
  const m = String(codigo || '').trim().toUpperCase().match(PATRON);
  return m ? { sede: m[1], origen: m[2], tipo: m[3], numero: Number(m[4]) } : null;
}

async function leerCatalogo(q) {
  try {
    const r = (await q.query('SELECT valor FROM ajustes WHERE clave=$1', [CLAVE_AJUSTE])).rows[0];
    if (!r?.valor) return CATALOGO_POR_DEFECTO;
    const g = JSON.parse(r.valor);
    return {
      sedes: g.sedes?.length ? g.sedes : CATALOGO_POR_DEFECTO.sedes,
      origenes: g.origenes?.length ? g.origenes : CATALOGO_POR_DEFECTO.origenes,
      tipos: g.tipos?.length ? g.tipos : CATALOGO_POR_DEFECTO.tipos,
      defecto: { ...CATALOGO_POR_DEFECTO.defecto, ...(g.defecto || {}) },
    };
  } catch { return CATALOGO_POR_DEFECTO; }
}

/** Sede, origen y tipo válidos: los que vienen si están en el catálogo; si no, los de por defecto. */
async function partesValidas(q, pedidas) {
  const cat = await leerCatalogo(q);
  const elegir = (lista, valor, defecto) => {
    const v = String(valor || '').trim().toUpperCase();
    return lista.some((x) => x.codigo === v) ? v : defecto;
  };
  return {
    sede: elegir(cat.sedes, pedidas?.sede, cat.defecto.sede),
    origen: elegir(cat.origenes, pedidas?.origen, cat.defecto.origen),
    tipo: elegir(cat.tipos, pedidas?.tipo, cat.defecto.tipo),
  };
}

/** Siguiente correlativo libre (único para todos los clientes). `minimo` sirve para saltar uno que ya se tomó. */
async function siguienteNumero(q, minimo = 1) {
  const r = await q.query("SELECT codigo_cliente FROM clientes WHERE codigo_cliente LIKE '%-_-%'");
  let mayor = 0;
  for (const x of r.rows) { const p = partesDeCodigo(x.codigo_cliente); if (p) mayor = Math.max(mayor, p.numero); }
  return Math.max(mayor + 1, minimo);
}

/** Código completo para un cliente nuevo (sin guardarlo). */
async function siguienteCodigoCliente(q, pedidas = null) {
  return armarCodigo(await partesValidas(q, pedidas), await siguienteNumero(q));
}

/**
 * Guarda en el cliente su código (y su correlativo en codigo_numero, cuyo índice único impide repetirlo entre sedes).
 * Sin la migración 20261117000000 la columna codigo_numero no existe: se guarda solo el código.
 */
async function guardarCodigo(q, id, codigo, { enTransaccion = false } = {}) {
  const p = partesDeCodigo(codigo);
  const sp = async (sql) => { if (enTransaccion) await q.query(sql); };
  try {
    await sp('SAVEPOINT codigo_cliente');
    await q.query('UPDATE clientes SET codigo_cliente=$1, codigo_numero=$2 WHERE id=$3', [codigo, p ? p.numero : null, id]);
    await sp('RELEASE SAVEPOINT codigo_cliente');
  } catch (e) {
    await sp('ROLLBACK TO SAVEPOINT codigo_cliente');
    if (e.code !== '42703') throw e;
    await sp('SAVEPOINT codigo_cliente');
    try {
      await q.query('UPDATE clientes SET codigo_cliente=$1 WHERE id=$2', [codigo, id]);
      await sp('RELEASE SAVEPOINT codigo_cliente');
    } catch (e2) { await sp('ROLLBACK TO SAVEPOINT codigo_cliente'); throw e2; }
  }
}

/**
 * Pone el código a un cliente recién creado con el siguiente correlativo. Si otro se lo ganó al mismo tiempo (índice
 * único), toma el siguiente. Dentro de una transacción usa SAVEPOINT para que un choque no la aborte.
 */
async function asignarCodigoCliente(q, id, pedidas = null, opciones = {}) {
  const partes = await partesValidas(q, pedidas);
  let numero = await siguienteNumero(q);
  for (let intento = 0; ; intento++) {
    const codigo = armarCodigo(partes, numero);
    try {
      await guardarCodigo(q, id, codigo, opciones);
      return codigo;
    } catch (e) {
      if (e.code !== '23505' || intento >= 5) throw e;
      numero = await siguienteNumero(q, numero + 1);
    }
  }
}

module.exports = { CATALOGO_POR_DEFECTO, CLAVE_AJUSTE, leerCatalogo, partesDeCodigo, armarCodigo, siguienteCodigoCliente, asignarCodigoCliente, guardarCodigo };
