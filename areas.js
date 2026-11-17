/**
 * Área de la etiqueta = estado de Venezuela al que va el envío (23 estados + Distrito Capital = 24).
 * Cada estado tiene un número para la casilla 区域 de la etiqueta PNG: 1 Distrito Capital (Caracas) y el resto en orden
 * alfabético. El administrador puede cambiar los números (ajustes.areas_destino); los estados no cambian.
 */
const ESTADOS = ['Distrito Capital', 'Amazonas', 'Anzoátegui', 'Apure', 'Aragua', 'Barinas', 'Bolívar', 'Carabobo', 'Cojedes',
  'Delta Amacuro', 'Falcón', 'Guárico', 'La Guaira', 'Lara', 'Mérida', 'Miranda', 'Monagas', 'Nueva Esparta', 'Portuguesa',
  'Sucre', 'Táchira', 'Trujillo', 'Yaracuy', 'Zulia'];
const AREAS_POR_DEFECTO = ESTADOS.map((estado, i) => ({ numero: String(i + 1), estado }));
const CLAVE_AREAS = 'areas_destino';

const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const SINONIMOS = { caracas: 'Distrito Capital', 'dtto capital': 'Distrito Capital', 'distrito federal': 'Distrito Capital', vargas: 'La Guaira' };

/** Nombre oficial del estado (acepta sin acentos, «Caracas», «Vargas»…), o null si no es uno de los 24. */
function estadoValido(v) {
  const k = sinAcentos(v);
  if (!k) return null;
  return SINONIMOS[k] || ESTADOS.find((e) => sinAcentos(e) === k) || null;
}

async function leerAreas(db) {
  try {
    const r = (await db.query('SELECT valor FROM ajustes WHERE clave=$1', [CLAVE_AREAS])).rows[0];
    if (!r?.valor) return AREAS_POR_DEFECTO;
    const guardadas = new Map(JSON.parse(r.valor).map((x) => [x.estado, String(x.numero || '').trim()]));
    return ESTADOS.map((estado, i) => ({ estado, numero: guardadas.get(estado) || String(i + 1) }));
  } catch { return AREAS_POR_DEFECTO; }
}

/** Valida la numeración que manda el administrador: los 24 estados, números de 1 a 6 caracteres sin repetir. */
function validarAreas(lista) {
  const porEstado = new Map((Array.isArray(lista) ? lista : []).map((x) => [estadoValido(x?.estado), String(x?.numero ?? '').trim().slice(0, 6)]));
  const areas = ESTADOS.map((estado, i) => ({ estado, numero: porEstado.get(estado) || String(i + 1) }));
  const numeros = areas.map((a) => a.numero);
  const repetido = numeros.find((n, i) => numeros.indexOf(n) !== i);
  return repetido ? { error: `El número ${repetido} está repetido en dos estados` } : { areas };
}

module.exports = { ESTADOS, AREAS_POR_DEFECTO, CLAVE_AREAS, estadoValido, leerAreas, validarAreas };
