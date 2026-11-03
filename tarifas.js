/**
 * Tarifas de referencia del flete China → Venezuela. ÚNICA fuente: las usa la web pública (/api/web/tarifas y
 * /api/web/cotizar) y deben coincidir con la calculadora del panel (public/app.js, CBM_TARIFFS / LAND_TARIFFS).
 * La cotización formal la confirma la asesora; esto es un estimado.
 */

const BASE_USD_POR_CBM = 660;
const CAPACIDAD_CONTENEDOR_CBM = 68; // contenedor de 40' (CX_CAPACITY en el panel)

/** Extra de despacho por tipo de mercancía y tramo de volumen: [<1 m³, 1–5 m³, >5–10 m³, >10 m³]. */
const MERCANCIAS = {
  light: { titulo: 'Ligera / inflamable / explosiva', puerta: [180, 150, 120, 120] },
  imitation: { titulo: 'Imitación / médica / maquinaria', puerta: [150, 120, 100, 100], retiro: [150, 120, 100, 100] },
  hardware: { titulo: 'Ferretería / electro / autopartes', puerta: [100, 80, 60, 60] },
  none: { titulo: 'No aplica', puerta: [0, 0, 0, 0], retiro: [0, 0, 0, 0] },
};

const TRAMOS = ['Menor a 1 m³', 'De 1 a 5 m³', 'Mayor a 5 y hasta 10 m³', 'Mayor a 10 m³'];

/** Traslado terrestre desde Valencia (USD) por estado. Carabobo = retiro/entrega local. */
const TERRESTRE = {
  Amazonas: 150, Anzoátegui: 100, Apure: 80, Aragua: 20, Barinas: 110, Bolívar: 150, Carabobo: 0, Caracas: 20, Cojedes: 20,
  'Delta Amacuro': 150, Falcón: 40, Guárico: 80, Lara: 20, Mérida: 130, Miranda: 20, Monagas: 130, 'Nueva Esparta': 130,
  Portuguesa: 60, Sucre: 130, Táchira: 130, Trujillo: 110, Vargas: 20, Yaracuy: 20, Zulia: 130,
};

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const tramo = (cbm) => (cbm < 1 ? 0 : cbm <= 5 ? 1 : cbm <= 10 ? 2 : 3);

/**
 * Cotiza a partir de cajas (medidas en cm) o de un CBM ya calculado.
 * @param {{ cajas?: {largoCm:number,anchoCm:number,altoCm:number,cantidad:number}[], cbm?: number,
 *           mercancia?: string, modalidad?: 'puerta'|'retiro', estado?: string }} e
 */
function cotizar(e = {}) {
  const cajas = Array.isArray(e.cajas) ? e.cajas : [];
  let cbm = Number(e.cbm) || 0;
  if (cajas.length) {
    cbm = cajas.reduce((s, c) => s + (Number(c.largoCm) * Number(c.anchoCm) * Number(c.altoCm) * Math.max(1, Math.trunc(Number(c.cantidad) || 1))) / 1e6, 0);
  }
  if (!(cbm > 0) || !Number.isFinite(cbm) || cbm > CAPACIDAD_CONTENEDOR_CBM * 10) return { error: 'Indica medidas y cantidad de cajas válidas' };

  const modalidad = e.modalidad === 'retiro' ? 'retiro' : 'puerta';
  const clave = MERCANCIAS[e.mercancia] ? e.mercancia : 'imitation';
  const t = tramo(cbm);
  const extra = (modalidad === 'retiro' ? MERCANCIAS[clave].retiro?.[t] : MERCANCIAS[clave].puerta[t]) || 0;
  const estado = modalidad === 'puerta' && Object.hasOwn(TERRESTRE, e.estado) ? e.estado : null;
  if (modalidad === 'puerta' && !estado) return { error: 'Indica el estado de destino' };
  const terrestre = estado ? TERRESTRE[estado] : 0;
  const base = cbm * BASE_USD_POR_CBM;

  return {
    cbm: Math.round(cbm * 1000) / 1000,
    mercancia: clave,
    modalidad,
    estado,
    tramo: TRAMOS[t],
    baseUsd: r2(base),
    extraUsd: r2(extra),
    terrestreUsd: r2(terrestre),
    totalUsd: r2(base + extra + terrestre),
    ocupacionContenedorPct: Math.round(Math.min(100, (cbm / CAPACIDAD_CONTENEDOR_CBM) * 100) * 10) / 10,
  };
}

/** Lo que la web necesita para cotizar en el navegador sin esperar al servidor (mismo cálculo que cotizar()). */
function publicas() {
  return {
    baseUsdPorCbm: BASE_USD_POR_CBM,
    capacidadContenedorCbm: CAPACIDAD_CONTENEDOR_CBM,
    tramos: TRAMOS,
    mercancias: Object.entries(MERCANCIAS).map(([clave, m]) => ({ clave, titulo: m.titulo, puerta: m.puerta, retiro: m.retiro || null })),
    terrestre: TERRESTRE,
  };
}

module.exports = { cotizar, publicas, TERRESTRE, CAPACIDAD_CONTENEDOR_CBM };
