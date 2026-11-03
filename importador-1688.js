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
  return { ia: base, iaActiva: Boolean(base.url && base.modelo), iaImagenes: base.imagenes, api: plantilla && process.env.IMPORT_1688_CLAVE ? plantilla : '' };
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

function registrar(app, { auth, logAction }) {
  const soloAdmin = (req, res) => {
    if (req.user.rol === 'admin') return true;
    res.status(403).json({ error: 'Solo el administrador' });
    return false;
  };

  app.get('/api/tienda/admin/importar/estado', auth, (req, res) => {
    if (!soloAdmin(req, res)) return;
    const c = configuracion();
    res.json({ ia: c.iaActiva, iaImagenes: c.iaImagenes, api: Boolean(c.api), margenPct: Number(process.env.TIENDA_MARGEN_PCT) || 35, tasaCny: Number(process.env.TIENDA_TASA_CNY) || 7.1 });
  });

  app.post('/api/tienda/admin/importar', auth, (req, res, next) => subir.array('capturas', MAX_CAPTURAS)(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Cada captura debe pesar menos de 8 MB' : err.code === 'LIMIT_FILE_COUNT' ? `Máximo ${MAX_CAPTURAS} capturas` : 'No se pudieron recibir las capturas' }) : next())), async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const cfg = configuracion();
      if (!cfg.iaActiva) return res.status(503).json({ error: 'El importador usa la IA del lector de packing list y no está configurada (IA_PROVEEDOR e IA_API_KEY).' });
      const url = txt(req.body?.url, 600);
      const texto = txt(req.body?.texto, MAX_TEXTO);
      const capturas = (req.files || []).map((f) => ({ f, mime: ia.tipoDeImagen(f.buffer) })).filter((x) => x.mime);
      if ((req.files || []).length && !capturas.length) return res.status(400).json({ error: 'Las capturas deben ser JPG, PNG o WEBP.' });
      if (capturas.length && !cfg.iaImagenes) return res.status(400).json({ error: 'La IA configurada no lee imágenes: pega el texto de la página.' });

      const partes = [];
      if (url && cfg.api) {
        // Vía API: la respuesta del intermediario (JSON o XML) se le pasa a la IA tal cual.
        const id = idDeEnlace(url);
        if (!id) return res.status(400).json({ error: 'No se reconoce el número del producto en el enlace.' });
        const destino = cfg.api.replace('{id}', encodeURIComponent(id)).replace('{url}', encodeURIComponent(url)).replace('{clave}', encodeURIComponent(process.env.IMPORT_1688_CLAVE));
        const r = await fetch(destino, { signal: AbortSignal.timeout(12000) });
        const crudo = await r.text();
        if (!r.ok) return res.status(502).json({ error: `El proveedor de datos respondió ${r.status}.` });
        partes.push({ type: 'text', text: `Respuesta de la API del mercado para ${url}:\n${crudo.slice(0, MAX_TEXTO)}` });
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

module.exports = { registrar, normalizar, sugerirPrecio, tramoPara, idDeEnlace };
