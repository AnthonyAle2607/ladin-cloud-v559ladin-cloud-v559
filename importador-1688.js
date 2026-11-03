/**
 * Importador de productos de mercados chinos (1688, Taobao, Yiwugo…) para la tienda. Semiautomático: arma un BORRADOR
 * traducido con precio sugerido; el equipo lo revisa, pone cupo y contenedor, y lo publica desde el panel.
 *
 *   GET  /api/tienda/admin/importar/estado → qué vías están disponibles
 *   POST /api/tienda/admin/importar         → multipart: `capturas` (hasta 4 fotos de la página), `texto` (texto copiado
 *                                            de la página) y/o `url` (enlace del producto, si hay API configurada)
 *
 * Dos vías, con la misma IA del lector de packing list (packing-ia.js) para entender y traducir:
 *  - Capturas o texto: funciona ya con la IA configurada (IA_PROVEEDOR / IA_API_KEY).
 *  - Enlace + API de un intermediario (p. ej. OTAPI): IMPORT_1688_URL es una plantilla con {id}, {url} y {clave}
 *    (IMPORT_1688_CLAVE). La respuesta del proveedor, sea cual sea su formato, la interpreta la IA.
 *
 * Precio sugerido: costo en yuanes ÷ tasa (TIENDA_TASA_CNY) + envío dentro de China (TIENDA_ENVIO_CHINA_PCT)
 * + flete marítimo por unidad (tarifa por m³ de tarifas.js × volumen de la caja ÷ unidades por caja), y sobre eso
 * el margen (TIENDA_MARGEN_PCT). Es una sugerencia: el precio final lo decide el equipo.
 */
const multer = require('multer');
const ia = require('./packing-ia');
const tarifas = require('./tarifas');

const MAX_CAPTURAS = 4;
const MAX_TEXTO = 40000;
const subir = multer({ storage: multer.memoryStorage(), limits: { files: MAX_CAPTURAS, fileSize: 8 * 1024 * 1024 } });

const num = (v) => { const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const txt = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const lista = (v, max = 12, largo = 400) => (Array.isArray(v) ? v.map((x) => txt(x, largo)).filter(Boolean).slice(0, max) : []);

const INSTRUCCIONES = `Eres comprador de una empresa que importa de China a Venezuela y vende en preventa. Recibes la página de un producto de un mercado mayorista chino (1688, Taobao, Yiwugo, Alibaba…) como capturas de pantalla, texto copiado o la respuesta JSON de una API. Devuelves SOLO un objeto JSON, sin texto adicional, con esta forma exacta:
{
  "esProducto": true,
  "nombre": "nombre comercial corto en español, sin marcas que no aparezcan (máx. 60 caracteres)",
  "nombreOriginal": "título tal como aparece",
  "proveedor": "nombre de la tienda o fábrica",
  "origen": "ciudad, China (p. ej. 'Yiwu, China'); null si no aparece",
  "url": "enlace del producto si aparece",
  "moneda": "CNY o USD, según la moneda en que se muestran los precios",
  "precios": [{ "desdeUnidades": 2, "precio": 12.5 }],
  "pedidoMinimo": 2,
  "unidad": "pieza, juego, par…",
  "nombreVariante": "qué distingue a las variantes en español: Color, Talla, Modelo, Kit… (null si no hay)",
  "variantes": [{ "nombre": "variante traducida al español", "precio": 12.5 }],
  "descripcion": ["1 a 3 párrafos breves en español, claros para un cliente venezolano"],
  "especificaciones": ["Material: …", "Potencia: …", "Medidas: …"],
  "paquete": { "largoCm": 50, "anchoCm": 40, "altoCm": 30, "pesoKg": 12, "unidadesPorCaja": 20 },
  "medidasUnidad": { "largoCm": 25, "anchoCm": 8, "altoCm": 1, "pesoKg": 0.02 },
  "pesoUnitarioKg": 0.5,
  "imagenes": ["URLs absolutas de las fotos del producto, si aparecen en el texto o en el JSON"],
  "categoriaSugerida": "Ferretería | Electro | Hogar | Autopartes | otra palabra corta",
  "notas": "advertencias: datos que faltan, dudas, posibles marcas registradas o réplicas"
}
Reglas:
- Traduce al español todo lo que vaya al cliente (nombre, variantes, descripción, especificaciones). No inventes datos: si algo no aparece, null o lista vacía.
- "precios": los precios por tramo de cantidad (起批量 / 价格 / 件以上 / «≥2 piezas»); "precio" es el precio unitario como número, en la moneda que indicas en "moneda" (¥ / 元 = CNY; US$ / $ = USD). Si un precio dice «envío gratis por 1 pieza», es un tramo desde 1 unidad.
- "medidasUnidad": medidas y peso de UNA unidad empacada (tabla «peso del producto» / 商品件重尺), si aparece.
- "variantes": cada opción de 颜色 / 规格 / 型号 / 尺码 con su precio unitario si es distinto; si no hay variantes, lista vacía.
- "paquete": la caja de exportación (装箱 / 箱规 / 外箱尺寸 / 每箱数量 / 毛重). Medidas en cm y peso en kg; convierte si vienen en mm o g. Si no aparece, null.
- Si no es la página de un producto, "esProducto": false y explica en "notas".
- Nunca copies textos promocionales exagerados; escribe neutro y concreto.`;

function configuracion() {
  const base = ia.configuracion();
  // Leer una ficha de producto no requiere el modelo que razona más: los «lite» responden mucho antes, y en Vercel
  // la función se corta a los 30 s. IMPORT_IA_MODELO (lista separada por comas) permite fijar otro orden.
  const propios = String(process.env.IMPORT_IA_MODELO || '').split(',').map((m) => m.trim()).filter(Boolean);
  base.modelos = propios.length ? propios : [...base.modelos.filter((m) => /lite/i.test(m)), ...base.modelos.filter((m) => !/lite/i.test(m))];
  base.modelo = base.modelos[0] || base.modelo;
  const plantilla = txt(process.env.IMPORT_1688_URL, 600);
  const busqueda = txt(process.env.IMPORT_1688_BUSQUEDA_URL, 1200);
  const clave = process.env.IMPORT_1688_CLAVE;
  // Apify (actor «1688 Product Scraper»): el token va en IMPORT_APIFY_TOKEN; IMPORT_APIFY_BASE solo para pruebas.
  const apify = process.env.IMPORT_APIFY_TOKEN
    ? { token: process.env.IMPORT_APIFY_TOKEN, actor: txt(process.env.IMPORT_APIFY_ACTOR, 80) || 'hezgLkHcDL7dwaDHo', base: txt(process.env.IMPORT_APIFY_BASE, 200) || 'https://api.apify.com' }
    : null;
  return { ia: base, iaActiva: Boolean(base.url && base.modelo), iaImagenes: base.imagenes, api: plantilla && clave ? plantilla : '', busqueda: busqueda && clave ? busqueda : '', apify };
}

/** Número de oferta de un enlace de 1688 (detail.1688.com/offer/123456.html) o el último número largo del enlace. */
function idDeEnlace(url) {
  const m = String(url).match(/offer\/(\d{6,})/) || String(url).match(/[?&](?:id|offerId)=(\d{6,})/) || String(url).match(/(\d{8,})/);
  return m ? m[1] : null;
}

function normalizar(b) {
  const precios = (Array.isArray(b?.precios) ? b.precios : [])
    .map((p) => ({ desdeUnidades: Math.max(1, Math.trunc(num(p?.desdeUnidades) || 1)), precio: num(p?.precio) }))
    .filter((p) => p.precio)
    .sort((a, c) => a.desdeUnidades - c.desdeUnidades)
    .slice(0, 8);
  const paq = b?.paquete || {};
  const paquete = { largoCm: num(paq.largoCm), anchoCm: num(paq.anchoCm), altoCm: num(paq.altoCm), pesoKg: num(paq.pesoKg), unidadesPorCaja: num(paq.unidadesPorCaja) ? Math.trunc(num(paq.unidadesPorCaja)) : null };
  const un = b?.medidasUnidad || {};
  const medidasUnidad = { largoCm: num(un.largoCm), anchoCm: num(un.anchoCm), altoCm: num(un.altoCm), pesoKg: num(un.pesoKg) };
  const moneda = /usd|us\$|dólar|dolar/i.test(String(b?.moneda || '')) ? 'USD' : 'CNY';
  const imagenes = lista(b?.imagenes, 8, 600).map((u) => (u.startsWith('//') ? 'https:' + u : u)).filter((u) => /^https:\/\//.test(u));
  return {
    esProducto: b?.esProducto !== false,
    nombre: txt(b?.nombre, 150),
    nombreOriginal: txt(b?.nombreOriginal, 300),
    proveedor: txt(b?.proveedor, 150),
    origen: txt(b?.origen, 120),
    url: /^https?:\/\//.test(txt(b?.url, 600)) ? txt(b?.url, 600) : '',
    moneda,
    precios,
    pedidoMinimo: num(b?.pedidoMinimo) ? Math.trunc(num(b.pedidoMinimo)) : precios[0]?.desdeUnidades ?? null,
    unidad: txt(b?.unidad, 40),
    nombreVariante: txt(b?.nombreVariante, 40),
    variantes: (Array.isArray(b?.variantes) ? b.variantes : []).map((v) => ({ nombre: txt(v?.nombre, 80), precio: num(v?.precio) })).filter((v) => v.nombre).slice(0, 20),
    descripcion: lista(b?.descripcion, 4, 600),
    especificaciones: lista(b?.especificaciones, 15, 200),
    paquete,
    medidasUnidad,
    pesoUnitarioKg: num(b?.pesoUnitarioKg),
    imagenes,
    categoriaSugerida: txt(b?.categoriaSugerida, 40),
    notas: txt(b?.notas, 600),
  };
}

const FACTOR_EMPAQUE = 1.2; // si solo hay medidas por unidad: +20 % de volumen por la caja de exportación y los huecos

/** Tramo de precio que aplica a la cantidad que se piensa comprar (el último cuyo «desde» no la supera). */
function tramoPara(precios, cantidad) {
  let elegido = precios[0] ?? null;
  for (const t of precios) if (t.desdeUnidades <= cantidad) elegido = t;
  return elegido;
}

/** Redondeo comercial: de 0,25 en 0,25 bajo $5; de 0,50 bajo $20; de $1 en adelante. */
function redondearPrecio(n) {
  const paso = n < 5 ? 0.25 : n < 20 ? 0.5 : 1;
  return r2(Math.ceil(n / paso) * paso);
}

/**
 * Precio sugerido en USD para un precio de origen (CNY o USD), con el desglose para que el equipo lo entienda.
 * Flete: con la caja de exportación, su volumen ÷ unidades por caja; si solo hay medidas por unidad, ese volumen
 * con un factor de empaque (aproximado).
 */
function sugerirPrecio(precio, moneda, d) {
  const tasa = Number(process.env.TIENDA_TASA_CNY) || 7.1; // yuanes por dólar
  const envioChina = (Number(process.env.TIENDA_ENVIO_CHINA_PCT) || 8) / 100;
  const margen = (Number(process.env.TIENDA_MARGEN_PCT) || 35) / 100;
  const costo = moneda === 'USD' ? precio : precio / tasa;
  const p = d.paquete;
  const u = d.medidasUnidad || {};
  let cbmUnidad = null;
  let fleteSegun = null;
  if (p.largoCm && p.anchoCm && p.altoCm && p.unidadesPorCaja) { cbmUnidad = (p.largoCm * p.anchoCm * p.altoCm) / 1e6 / p.unidadesPorCaja; fleteSegun = 'caja'; }
  else if (u.largoCm && u.anchoCm && u.altoCm) { cbmUnidad = ((u.largoCm * u.anchoCm * u.altoCm) / 1e6) * FACTOR_EMPAQUE; fleteSegun = 'unidad'; }
  const flete = cbmUnidad != null ? cbmUnidad * tarifas.publicas().baseUsdPorCbm : null;
  const base = costo * (1 + envioChina) + (flete ?? 0);
  return {
    precioUsd: redondearPrecio(base * (1 + margen)),
    desglose: { precioOrigen: precio, moneda, tasa: moneda === 'USD' ? null : tasa, costoUsd: r2(costo), envioChinaUsd: r2(costo * envioChina), fleteUsd: flete != null ? r2(flete) : null, fleteSegun, margenPct: Math.round(margen * 100) },
  };
}

function revisar(d, sugerido) {
  const avisos = [];
  if (!d.esProducto) avisos.push('La IA no reconoce una página de producto. Revisa las capturas o el texto.');
  if (!d.precios.length) avisos.push('No se encontró el precio: el precio sugerido no se puede calcular.');
  if (sugerido?.desglose.fleteSegun === 'unidad') avisos.push('El flete se calculó con las medidas de una unidad (+20 % de empaque): es aproximado. Pide al proveedor la caja de exportación (medidas y unidades por caja).');
  else if (sugerido && !sugerido.desglose.fleteSegun) avisos.push('Faltan las medidas de la caja o del producto: el precio sugerido no incluye el flete marítimo. Pídeselas al proveedor.');
  if (!d.imagenes.length) avisos.push('Sin fotos del producto: súbelas en el borrador (mejor fotos propias del almacén de Yiwu).');
  if (d.notas) avisos.push(`Nota de la IA: ${d.notas}`);
  return avisos;
}

/* ---------- búsqueda ---------- */

// Nombres que usan los distintos proveedores (OTAPI, Apify, TMAPI…) para cada dato de un resultado de búsqueda.
const CAMPOS_RESULTADO = {
  id: ['offerid', 'id', 'itemid', 'numiid', 'productid'],
  titulo: ['title', 'subject', 'itemtitle', 'name', 'originaltitle', 'producttitle'],
  url: ['url', 'detailurl', 'externalitemurl', 'itemurl', 'link', 'producturl', 'offerurl'],
  imagen: ['mainimage', 'image', 'imageurl', 'mainpictureurl', 'picurl', 'img', 'picture', 'pic', 'images', 'pictures'],
  precio: ['price', 'pricemin', 'promotionprice', 'saleprice', 'minprice', 'originalprice'],
  moneda: ['currency', 'currencycode', 'currencysign'],
  proveedor: ['companyname', 'vendorname', 'sellername', 'shopname', 'seller', 'vendordisplayname', 'suppliername'],
  ubicacion: ['city', 'location', 'vendorlocation', 'province', 'shippinglocation', 'area'],
  pedidoMinimo: ['moq', 'minorderquantity', 'quantitybegin', 'firstlotquantity', 'beginamount'],
};
const clavePlana = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '');

function campo(obj, nombres) {
  for (const [k, v] of Object.entries(obj)) if (nombres.includes(clavePlana(k)) && v != null && v !== '') return v;
  return null;
}

/** Primer número dentro de un valor (los precios a veces vienen como objeto { OriginalPrice, ConvertedPrice… }). */
function primerNumero(v, profundidad = 0) {
  if (v == null || profundidad > 3) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  if (typeof v === 'string') return num(v);
  if (Array.isArray(v)) { for (const x of v) { const n = primerNumero(x, profundidad + 1); if (n) return n; } return null; }
  if (typeof v === 'object') {
    for (const k of ['OriginalPrice', 'Value', 'price', 'Price', 'value', 'amount', 'min']) if (v[k] != null) { const n = primerNumero(v[k], profundidad + 1); if (n) return n; }
    for (const x of Object.values(v)) { const n = primerNumero(x, profundidad + 1); if (n) return n; }
  }
  return null;
}

/** Texto de un valor que puede venir como objeto ({ City: 'Yiwu' }): el primer texto que tenga. */
function textoDe(v, max) {
  if (v == null) return '';
  if (typeof v === 'object') return txt(Object.values(v).find((x) => typeof x === 'string' && x.trim()) || '', max);
  return txt(v, max);
}

function primeraImagen(v) {
  if (!v) return '';
  if (typeof v === 'string') return v.startsWith('//') ? 'https:' + v : v;
  if (Array.isArray(v)) return primeraImagen(v[0]);
  if (typeof v === 'object') return primeraImagen(v.Url || v.url || v.Large?.Url || v.Medium?.Url || Object.values(v).find((x) => typeof x === 'string' && /^(https?:)?\/\//.test(x)));
  return '';
}

/**
 * Busca, dentro de la respuesta de cualquier proveedor, la lista de productos: el arreglo de objetos donde la mayoría
 * tiene título y enlace o identificador. Así no depende del formato exacto de cada API.
 */
function extraerResultados(json) {
  let mejor = [];
  const recorrer = (v, profundidad) => {
    if (profundidad > 7 || v == null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objetos = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
      const validos = objetos.filter((o) => campo(o, CAMPOS_RESULTADO.titulo) && (campo(o, CAMPOS_RESULTADO.url) || campo(o, CAMPOS_RESULTADO.id)));
      if (validos.length >= Math.max(1, objetos.length / 2) && validos.length > mejor.length) mejor = validos;
      v.forEach((x) => recorrer(x, profundidad + 1));
      return;
    }
    Object.values(v).forEach((x) => recorrer(x, profundidad + 1));
  };
  recorrer(json, 0);
  return mejor.slice(0, 60).map((o) => {
    let url = txt(campo(o, CAMPOS_RESULTADO.url), 600);
    if (url.startsWith('//')) url = 'https:' + url;
    const idCrudo = String(campo(o, CAMPOS_RESULTADO.id) ?? '');
    const id = (idCrudo.match(/(\d{6,})/) || [])[1] || idDeEnlace(url) || '';
    if (!/^https?:\/\//.test(url) && id) url = `https://detail.1688.com/offer/${id}.html`;
    const moneda = /usd|\$/i.test(String(campo(o, CAMPOS_RESULTADO.moneda) || '')) ? 'USD' : 'CNY';
    return {
      id,
      titulo: txt(campo(o, CAMPOS_RESULTADO.titulo), 200),
      url,
      imagen: primeraImagen(campo(o, CAMPOS_RESULTADO.imagen)),
      precio: primerNumero(campo(o, CAMPOS_RESULTADO.precio)),
      moneda,
      proveedor: textoDe(campo(o, CAMPOS_RESULTADO.proveedor), 120),
      ubicacion: textoDe(campo(o, CAMPOS_RESULTADO.ubicacion), 80),
      pedidoMinimo: num(campo(o, CAMPOS_RESULTADO.pedidoMinimo)),
    };
  }).filter((r) => /^https?:\/\//.test(r.url));
}

/** Traduce los títulos al español en una sola consulta corta a la IA (modelos «lite»). Si falla, quedan como vienen. */
async function traducirTitulos(cfg, resultados) {
  if (!cfg.iaActiva || !resultados.length || !resultados.some((r) => /[一-鿿]/.test(r.titulo))) return resultados;
  try {
    const instrucciones = 'Traduces títulos de productos mayoristas chinos al español. Devuelve SOLO JSON: {"titulos": ["…"]}, en el mismo orden y la misma cantidad. Cada título: nombre comercial corto y claro (máx. 70 caracteres), sin palabras de relleno ni marcas que no aparezcan.';
    const r = await ia.preguntarIA({ ...cfg.ia, instrucciones, esperaMs: Math.min(cfg.ia.esperaMs, 15000) }, [{ type: 'text', text: JSON.stringify(resultados.map((x) => x.titulo)) }]);
    const t = Array.isArray(r.datos?.titulos) ? r.datos.titulos : [];
    if (t.length !== resultados.length) return resultados;
    return resultados.map((x, i) => ({ ...x, tituloOriginal: x.titulo, titulo: txt(t[i], 200) || x.titulo }));
  } catch (e) {
    console.warn('Importador: no se pudieron traducir los títulos de la búsqueda:', e.message);
    return resultados;
  }
}

function registrar(app, { auth, logAction }) {
  const soloAdmin = (req, res) => {
    if (req.user.rol === 'admin') return true;
    res.status(403).json({ error: 'Solo el administrador' });
    return false;
  };

  app.get('/api/tienda/admin/importar/estado', auth, (req, res) => {
    if (!soloAdmin(req, res)) return;
    const c = configuracion();
    res.json({ ia: c.iaActiva, iaImagenes: c.iaImagenes, api: Boolean(c.api), busqueda: Boolean(c.busqueda), apify: Boolean(c.apify), margenPct: Number(process.env.TIENDA_MARGEN_PCT) || 35, tasaCny: Number(process.env.TIENDA_TASA_CNY) || 7.1 });
  });

  /**
   * Búsqueda por palabra en el mercado, con la API del intermediario: IMPORT_1688_BUSQUEDA_URL es una plantilla con
   * {q} (lo que se busca), {pagina} (desde 1), {desde} (posición, desde 0) y {clave}. Devuelve tarjetas para elegir cuáles
   * importar; cada una se importa después por su enlace con la ruta de arriba.
   */
  /**
   * Apify: un trabajo puede tardar más que los 30 s de Vercel, así que no se espera aquí. Esta ruta lo LANZA
   * (búsqueda por palabra o lista de enlaces) y devuelve su id; el panel consulta la siguiente hasta que termine.
   */
  app.post('/api/tienda/admin/importar/apify', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const { apify } = configuracion();
      if (!apify) return res.status(503).json({ error: 'Falta IMPORT_APIFY_TOKEN en el servidor.' });
      const q = txt(req.body?.q, 120);
      const enlaces = (Array.isArray(req.body?.enlaces) ? req.body.enlaces : []).map((u) => txt(u, 600)).filter((u) => /^https?:\/\/[^\s]+(1688|taobao|tmall|alibaba)\.com\//i.test(u)).slice(0, 50);
      if (!q && !enlaces.length) return res.status(400).json({ error: 'Indica qué buscar o los enlaces de 1688.' });
      const entrada = q
        ? { keywords: [q], maxItems: Math.max(1, Math.min(60, Math.trunc(Number(req.body?.max) || 20))), sortBy: 'default', enrichSearchResults: false, includeAds: false }
        : { productUrls: enlaces, maxItems: enlaces.length, enrichSearchResults: true, includeAds: false };
      entrada.proxyConfiguration = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] };
      const r = await fetch(`${apify.base}/v2/acts/${encodeURIComponent(apify.actor)}/runs?token=${encodeURIComponent(apify.token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entrada), signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.data?.id) return res.status(502).json({ error: `Apify respondió ${r.status}${j?.error?.message ? `: ${txt(j.error.message, 200)}` : ''}` });
      res.json({ run: j.data.id, tipo: q ? 'busqueda' : 'enlaces' });
    } catch (e) {
      console.error('Apify (iniciar):', e.message);
      res.status(502).json({ error: 'No se pudo iniciar el trabajo en Apify' });
    }
  });

  app.get('/api/tienda/admin/importar/apify/:run', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const { apify } = configuracion();
      if (!apify) return res.status(503).json({ error: 'Falta IMPORT_APIFY_TOKEN en el servidor.' });
      const run = String(req.params.run);
      if (!/^[A-Za-z0-9]{6,40}$/.test(run)) return res.status(400).json({ error: 'Trabajo no válido' });
      const t = `token=${encodeURIComponent(apify.token)}`;
      const r = await fetch(`${apify.base}/v2/actor-runs/${run}?${t}`, { signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.data) return res.status(502).json({ error: `Apify respondió ${r.status}` });
      const estado = j.data.status;
      if (['READY', 'RUNNING'].includes(estado)) return res.json({ estado: 'trabajando' });
      if (estado !== 'SUCCEEDED') return res.json({ estado: 'fallo', error: `El trabajo en Apify terminó con estado ${estado}. Revisa el saldo y el actor en apify.com.` });
      const d = await fetch(`${apify.base}/v2/datasets/${encodeURIComponent(j.data.defaultDatasetId)}/items?clean=true&limit=100&${t}`, { signal: AbortSignal.timeout(15000) });
      const items = await d.json().catch(() => []);
      if (!Array.isArray(items)) return res.status(502).json({ error: 'Apify no devolvió una lista de productos' });
      const resultados = await traducirTitulos(configuracion(), extraerResultados(items));
      // Para importar, cada ficha completa vuelve al panel (sin estado en el servidor: Vercel no lo conserva).
      const fichas = items.slice(0, 50).map((x) => ({ url: txt(x.url, 600) || (x.offerId ? `https://detail.1688.com/offer/${x.offerId}.html` : ''), crudo: JSON.stringify(x).slice(0, MAX_TEXTO) }));
      res.json({ estado: 'listo', resultados, fichas, costo: j.data.usageTotalUsd ?? null });
    } catch (e) {
      console.error('Apify (consultar):', e.message);
      res.status(502).json({ error: 'No se pudo consultar el trabajo en Apify' });
    }
  });

  app.post('/api/tienda/admin/importar/buscar', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const cfg = configuracion();
      if (!cfg.busqueda) return res.status(503).json({ error: 'La búsqueda necesita la API de un proveedor de datos (IMPORT_1688_BUSQUEDA_URL e IMPORT_1688_CLAVE).' });
      const q = txt(req.body?.q, 120);
      if (q.length < 2) return res.status(400).json({ error: 'Escribe qué buscar (por ejemplo «freidora de aire» o «空气炸锅»).' });
      const pagina = Math.max(1, Math.min(50, Math.trunc(Number(req.body?.pagina) || 1)));
      const porPagina = 20;
      const destino = cfg.busqueda
        .replace('{q}', encodeURIComponent(q))
        .replace('{pagina}', String(pagina))
        .replace('{desde}', String((pagina - 1) * porPagina))
        .replace('{clave}', encodeURIComponent(process.env.IMPORT_1688_CLAVE));
      const r = await fetch(destino, { signal: AbortSignal.timeout(15000) });
      const crudo = await r.text();
      if (!r.ok) return res.status(502).json({ error: `El proveedor de datos respondió ${r.status}.` });
      let json = null;
      try { json = JSON.parse(crudo); } catch { /* no es JSON: se intenta con la IA */ }
      let resultados = json ? extraerResultados(json) : [];
      if (!resultados.length && cfg.iaActiva) {
        // Formato desconocido (XML, HTML…): la IA saca la lista.
        const instrucciones = 'Recibes la respuesta de una búsqueda de productos de un mercado chino. Devuelve SOLO JSON: {"resultados":[{"id":"","title":"","url":"","image":"","price":0,"currency":"CNY","seller":"","location":""}]} con hasta 20 productos. No inventes datos.';
        const ai = await ia.preguntarIA({ ...cfg.ia, instrucciones, esperaMs: Math.min(cfg.ia.esperaMs, 20000) }, [{ type: 'text', text: crudo.slice(0, MAX_TEXTO) }]);
        resultados = extraerResultados(ai.datos);
      }
      resultados = await traducirTitulos(cfg, resultados);
      res.json({ q, pagina, resultados });
    } catch (e) {
      console.error('Búsqueda en 1688:', e.message);
      const tiempo = e.name === 'TimeoutError' || e.name === 'AbortError';
      res.status(tiempo ? 504 : 500).json({ error: tiempo ? 'El proveedor de datos tardó demasiado. Intenta de nuevo.' : 'No se pudo buscar' });
    }
  });

  app.post('/api/tienda/admin/importar', auth, (req, res, next) => subir.array('capturas', MAX_CAPTURAS)(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada captura debe pesar menos de 8 MB' : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_CAPTURAS} capturas` : 'No se pudieron recibir las capturas' }) : next())), async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const cfg = configuracion();
      if (!cfg.iaActiva) return res.status(503).json({ error: 'El importador usa la IA del lector de packing list y no está configurada (IA_PROVEEDOR e IA_API_KEY).' });
      const url = txt(req.body?.url, 600);
      const texto = txt(req.body?.texto, MAX_TEXTO);
      // Ficha ya descargada por Apify (el panel la trae de /importar/apify/:run): la IA la traduce y la normaliza.
      const crudo = txt(req.body?.crudo, MAX_TEXTO);
      const capturas = (req.files || []).map((f) => ({ f, mime: ia.tipoDeImagen(f.buffer) })).filter((x) => x.mime);
      if ((req.files || []).length && !capturas.length) return res.status(400).json({ error: 'Las capturas deben ser JPG, PNG o WEBP.' });
      if (capturas.length && !cfg.iaImagenes) return res.status(400).json({ error: 'La IA configurada no lee imágenes: pega el texto de la página.' });

      const partes = [];
      if (crudo) {
        // La ficha ya viene descargada (Apify): no se vuelve a consultar a ningún proveedor.
        partes.push({ type: 'text', text: `Datos del producto obtenidos de la API del mercado${url ? ` para ${url}` : ''} (JSON):\n${crudo}` });
      } else if (url && cfg.api) {
        // Vía API: la respuesta del intermediario (JSON o XML) se le pasa a la IA tal cual.
        const id = idDeEnlace(url);
        if (!id) return res.status(400).json({ error: 'No se reconoce el número del producto en el enlace.' });
        const destino = cfg.api.replace('{id}', encodeURIComponent(id)).replace('{url}', encodeURIComponent(url)).replace('{clave}', encodeURIComponent(process.env.IMPORT_1688_CLAVE));
        const r = await fetch(destino, { signal: AbortSignal.timeout(12000) });
        const respuesta = await r.text();
        if (!r.ok) return res.status(502).json({ error: `El proveedor de datos respondió ${r.status}.` });
        partes.push({ type: 'text', text: `Respuesta de la API del mercado para ${url}:\n${respuesta.slice(0, MAX_TEXTO)}` });
      } else if (url && !capturas.length && !texto) {
        return res.status(400).json({ error: 'La importación por enlace necesita la API de un intermediario (aún no configurada). Sube capturas de la página o pega su texto.' });
      }
      if (texto) partes.push({ type: 'text', text: `Texto copiado de la página${url ? ` (${url})` : ''}:\n${texto}` });
      for (const c of capturas) partes.push({ type: 'image_url', image_url: { url: `data:${c.mime};base64,${c.f.buffer.toString('base64')}` } });
      if (!partes.length) return res.status(400).json({ error: 'Sube capturas de la página del producto, pega su texto o indica el enlace.' });
      partes.unshift({ type: 'text', text: 'Extrae los datos de este producto según las instrucciones.' });

      const respuesta = await ia.preguntarIA({ ...cfg.ia, instrucciones: INSTRUCCIONES }, partes);
      const datos = normalizar(respuesta.datos);
      if (!datos.url && url) datos.url = url;
      // Se compra al mayor: el precio de referencia es el del tramo que corresponde a la cantidad que se piensa comprar.
      const cantidad = Math.max(1, Math.min(100000, Math.trunc(Number(req.body?.cantidad) || 100)));
      const tramo = tramoPara(datos.precios, cantidad);
      const sugerido = tramo ? { ...sugerirPrecio(tramo.precio, datos.moneda, datos), cantidad, tramoDesde: tramo.desdeUnidades } : null;
      const variantes = datos.variantes.map((v) => ({ ...v, precioSugeridoUsd: v.precio && tramo && v.precio !== tramo.precio && datos.precios.length <= 1 ? sugerirPrecio(v.precio, datos.moneda, datos).precioUsd : null }));
      await logAction(req.user.id, 'Producto leído para la tienda', 'tienda_productos', null, `${datos.nombre || 'Sin nombre'} · ${datos.proveedor || 'proveedor sin nombre'} (${cfg.ia.nombre}/${respuesta.modelo}).`);
      res.json({ datos: { ...datos, variantes }, sugerido, avisos: revisar(datos, sugerido) });
    } catch (e) {
      console.error('Importador de productos:', e.message);
      const tiempo = e.name === 'TimeoutError' || e.name === 'AbortError';
      res.status(tiempo ? 504 : e.status || 500).json({ error: tiempo ? 'La lectura tardó demasiado. Prueba con menos capturas.' : e.message || 'No se pudo leer el producto' });
    }
  });
}

module.exports = { registrar, normalizar, sugerirPrecio, tramoPara, idDeEnlace, extraerResultados };
