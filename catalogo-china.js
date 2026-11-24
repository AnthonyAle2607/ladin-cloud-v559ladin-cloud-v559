/**
 * Tienda de la web: el catálogo de 1688 en vivo a través de OTAPI (OT Commerce, https://otapi.net). Es la única tienda:
 * la web no importa nada, muestra categorías, búsqueda y la ficha del producto tal como vienen de 1688, traducidos al
 * español por OTAPI. Precio = precio de fábrica en yuanes ÷ tasa + envío dentro de China + margen; el flete marítimo
 * va aparte (estimado por el volumen de cada unidad, se suma en el carrito y lo confirma el equipo).
 * Nunca expone el costo en yuanes, el nombre del proveedor ni el enlace de 1688.
 *
 *   GET  /api/web/china/estado            → { activo }
 *   GET  /api/web/china/inicio            → { secciones: [{ titulo, q }] }: filas de la portada de la tienda (la web
 *                                           pide cada una por separado con buscar?tam=12, para no esperar a todas)
 *   GET  /api/web/china/categorias        → categorías principales de 1688
 *   GET  /api/web/china/buscar?q=&categoria=&pagina=&tam=   → { total, paginas, pagina, items } (tam 12 o 24)
 *   GET  /api/web/china/producto/:id      → ficha (fotos, tramos de precio, opciones, combinaciones, especificaciones)
 *   POST /api/web/china/pedido            → { items: [{ id, opciones, cantidad }], nombre, telefono, email, estado,
 *                                           mensaje }: el carrito llega al panel como un encargo (Solicitudes web) con
 *                                           los enlaces de 1688; el equipo confirma flete y total por WhatsApp
 *
 * Gasto: OTAPI cobra por llamada (búsqueda y ficha). Cada respuesta se guarda en la tabla china_cache (búsquedas 6 h,
 * fichas 6 h, categorías 7 días) y hay un tope diario de llamadas (CHINA_LLAMADAS_DIA, 3000 por defecto, en china_uso);
 * al llegar al tope solo se sirve lo que ya está en caché.
 *
 * Variables: OTAPI_KEY (clave de OT Commerce; sin ella la sección se apaga sola), OTAPI_URL (solo para pruebas),
 * CHINA_LLAMADAS_DIA. Precio: TIENDA_TASA_CNY, TIENDA_ENVIO_CHINA_PCT, TIENDA_MARGEN_PCT (ver importador-1688.js).
 */
const rateLimit = require('express-rate-limit');
const tarifas = require('./tarifas');

const PROVEEDOR = 'Alibaba1688';
const POR_PAGINA = 24;
const MAX_PAGINAS = 20;
const HORA = 3600 * 1000;
const TTL = { categorias: 7 * 24 * HORA, buscar: 6 * HORA, producto: 6 * HORA };
const FACTOR_EMPAQUE = 1.2; // volumen de una unidad + 20 % por la caja de exportación y los huecos (como el importador)
const MAX_LINEAS = 40;
/** Portada de la tienda: una fila de productos por búsqueda (se cambian con CHINA_SECCIONES="Título|búsqueda;…"). */
const SECCIONES = [
  ['Iluminación', 'lámpara led'], ['Hogar y cocina', 'utensilios de cocina'], ['Celulares y accesorios', 'accesorios para celular'],
  ['Belleza y cuidado personal', 'maquillaje'], ['Ferretería y herramientas', 'herramientas'], ['Accesorios para motos', 'accesorios para moto'],
  ['Juguetes', 'juguetes para niños'], ['Moda', 'ropa de mujer'],
];
const ID_VALIDO = /^abb-\d{5,20}$/;
const CAT_VALIDA = /^abb-\d{1,15}$/;

const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clave = () => String(process.env.OTAPI_KEY || '').trim();
const base = () => String(process.env.OTAPI_URL || 'https://otapi.net/service-json/').replace(/\/?$/, '/');
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

class ErrorChina extends Error {
  constructor(mensaje, status = 502) { super(mensaje); this.status = status; }
}

async function ensureSchema(db) {
  await db.query('CREATE TABLE IF NOT EXISTS china_cache (clave VARCHAR(300) PRIMARY KEY, valor TEXT NOT NULL, expira TIMESTAMP NOT NULL)');
  await db.query('CREATE TABLE IF NOT EXISTS china_uso (dia DATE PRIMARY KEY, llamadas INTEGER NOT NULL DEFAULT 0)');
}

function crear(db) {
  // Si falta la migración 20261120000000 (tablas china_cache y china_uso), la caché y el tope viven en memoria.
  const memoria = new Map();
  let usoMemoria = { dia: '', llamadas: 0 };
  const sinTabla = (e) => e && (e.code === '42P01' || e.code === '42703');

  async function leerCache(k) {
    try {
      const r = (await db.query('SELECT valor FROM china_cache WHERE clave=$1 AND expira > NOW()', [k])).rows[0];
      return r ? JSON.parse(r.valor) : null;
    } catch (e) {
      if (!sinTabla(e)) console.error('china_cache:', e.message);
      const m = memoria.get(k);
      return m && m.expira > Date.now() ? m.valor : null;
    }
  }

  async function guardarCache(k, valor, ttl) {
    memoria.set(k, { valor, expira: Date.now() + ttl });
    if (memoria.size > 500) memoria.delete(memoria.keys().next().value);
    try {
      await db.query(`INSERT INTO china_cache(clave,valor,expira) VALUES($1,$2,NOW() + ($3 || ' milliseconds')::interval)
        ON CONFLICT (clave) DO UPDATE SET valor=EXCLUDED.valor, expira=EXCLUDED.expira`, [k, JSON.stringify(valor), String(ttl)]);
      if (Math.random() < 0.02) await db.query('DELETE FROM china_cache WHERE expira < NOW()');
    } catch (e) { if (!sinTabla(e)) console.error('china_cache:', e.message); }
  }

  /** Suma una llamada al día de hoy; false si ya se llegó al tope. */
  async function gastar() {
    const tope = Number(process.env.CHINA_LLAMADAS_DIA) || 3000;
    try {
      const r = (await db.query(`INSERT INTO china_uso(dia,llamadas) VALUES(CURRENT_DATE,1)
        ON CONFLICT (dia) DO UPDATE SET llamadas = china_uso.llamadas + 1 WHERE china_uso.llamadas < $1 RETURNING llamadas`, [tope])).rows[0];
      return Boolean(r);
    } catch (e) {
      if (!sinTabla(e)) console.error('china_uso:', e.message);
      const hoy = new Date().toISOString().slice(0, 10);
      if (usoMemoria.dia !== hoy) usoMemoria = { dia: hoy, llamadas: 0 };
      if (usoMemoria.llamadas >= tope) return false;
      usoMemoria.llamadas++;
      return true;
    }
  }

  async function otapi(metodo, params) {
    if (!clave()) throw new ErrorChina('El catálogo de China no está disponible en este momento.', 503);
    if (!(await gastar())) throw new ErrorChina('El catálogo de China está muy solicitado hoy. Vuelve a intentarlo mañana o pídelo por encargo.', 503);
    const cuerpo = new URLSearchParams({ instanceKey: clave(), language: 'es', ...params });
    let r;
    try {
      r = await fetch(base() + metodo, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(27000) }); // Vercel corta a los 30 s (vercel.json)
    } catch {
      throw new ErrorChina('El catálogo de China tardó demasiado en responder. Intenta de nuevo.', 504);
    }
    const j = await r.json().catch(() => null);
    if (!j) throw new ErrorChina('Respuesta no válida del catálogo de China.');
    if (j.ErrorCode !== 'Ok' && j.ErrorCode !== 'BatchError') {
      if (j.ErrorCode === 'NotFound' || /not\s*found|NotAvailable/i.test(`${j.ErrorCode} ${j.SubErrorCode?.Value || ''}`)) throw new ErrorChina('Este producto ya no está disponible.', 404);
      console.error('OTAPI', metodo, j.ErrorCode, j.ErrorDescription);
      throw new ErrorChina(j.ErrorCode === 'InstanceKeyBan' || j.ErrorCode === 'AccessDenied' ? 'El catálogo de China no está disponible en este momento.' : 'No se pudo consultar el catálogo de China.', 502);
    }
    return j;
  }

  async function conCache(k, ttl, obtener) {
    const c = await leerCache(k);
    if (c) return c;
    const v = await obtener();
    await guardarCache(k, v, ttl);
    return v;
  }

  return { otapi, conCache };
}

/* ---------- transformación de las respuestas de OTAPI ---------- */

const yuanes = (precio) => Number(precio?.OriginalPrice) || 0;

function medidasDe(item) {
  const f = item.PhysicalParameters || {};
  const n = (v) => (Number(v) > 0 ? Number(v) : null);
  return { largoCm: n(f.Length), anchoCm: n(f.Width), altoCm: n(f.Height), pesoKg: n(f.Weight) };
}

/** Precio de la tienda en USD (sin flete) para un precio de fábrica en yuanes: ÷ tasa + envío en China + margen. */
function precioTienda(cny) {
  if (!(cny > 0)) return null;
  const tasa = Number(process.env.TIENDA_TASA_CNY) || 7.1; // yuanes por dólar
  const envioChina = (Number(process.env.TIENDA_ENVIO_CHINA_PCT) || 8) / 100;
  const margen = (Number(process.env.TIENDA_MARGEN_PCT) || 35) / 100;
  return Math.max(0.01, Math.ceil((cny / tasa) * (1 + envioChina) * (1 + margen) * 100 - 1e-6) / 100);
}

/** Flete marítimo estimado de una unidad (USD) por su volumen; null si 1688 no trae las medidas. */
function fleteUnidad(m) {
  if (!(m.largoCm && m.anchoCm && m.altoCm)) return null;
  const cbm = ((m.largoCm * m.anchoCm * m.altoCm) / 1e6) * FACTOR_EMPAQUE;
  return Math.ceil(cbm * tarifas.publicas().baseUsdPorCbm * 100) / 100;
}

function tramosDe(item) {
  const t = (item.QuantityRanges || []).map((q) => ({ desde: Math.max(1, Number(q.MinQuantity) || 1), cny: yuanes(q.Price) })).filter((q) => q.cny > 0);
  if (!t.length && yuanes(item.Price) > 0) t.push({ desde: 1, cny: yuanes(item.Price) });
  return t.sort((a, b) => a.desde - b.desde);
}

const pedidoMinimo = (item, tramos) => Math.max(1, Number(item.FirstLotQuantity) || 0, tramos[0]?.desde || 1);

function fotoDe(p, tam = 'Large') {
  return p?.[tam]?.Url || p?.Url || null;
}

function tarjeta(item) {
  if (!item || item.HasError || item.IsSellAllowed === false || !ID_VALIDO.test(item.Id || '')) return null;
  const tramos = tramosDe(item);
  if (!tramos.length) return null;
  const precio = precioTienda(tramos[0].cny);
  if (!precio) return null;
  const principal = (item.Pictures || []).find((p) => p.IsMain) || (item.Pictures || [])[0];
  const ventas = Number((item.FeaturedValues || []).find((f) => f.Name === 'SalesInLast30Days')?.Value) || 0;
  return {
    id: item.Id,
    titulo: texto(limpiarTitulo(item.Title || item.OriginalTitle), 200),
    foto: fotoDe(principal) || item.MainPictureUrl || null,
    precioUsd: precio,
    fleteUnidadUsd: fleteUnidad(medidasDe(item)),
    pedidoMinimo: pedidoMinimo(item, tramos),
    ventas30: ventas,
  };
}

const mayuscula = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Quita el relleno de los títulos de 1688: «(Al por mayor), (Comercio transfronterizo), mochila…» → «Mochila…». */
function limpiarTitulo(t) {
  const limpio = String(t || '')
    .replace(/[(（][^()（）]{0,30}[)）]/g, ' ')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/^[\s,.;:·\-–—]+|[\s,.;:·\-–—]+$/g, '')
    .replace(/\s{2,}/g, ' ');
  return mayuscula(limpio.length >= 6 ? limpio : String(t || '').trim());
}

function ficha(item) {
  const t = tarjeta(item);
  if (!t) return null;
  const medidas = medidasDe(item);
  const tramos = tramosDe(item);
  const fotos = [...new Set((item.Pictures || []).map((p) => p.Url).filter(Boolean))].slice(0, 12);
  const atributos = item.Attributes || [];
  const opciones = [];
  for (const a of atributos.filter((x) => x.IsConfigurator)) {
    let o = opciones.find((x) => x.id === a.Pid);
    if (!o) opciones.push((o = { id: a.Pid, nombre: mayuscula(texto(a.PropertyName || a.OriginalPropertyName, 60)), valores: [] }));
    if (!o.valores.some((v) => v.id === a.Vid)) o.valores.push({ id: a.Vid, nombre: texto(a.Value || a.OriginalValue, 120), foto: a.ImageUrl || null });
  }
  const tramo0 = tramos[0].cny;
  const combinaciones = (item.ConfiguredItems || []).slice(0, 400).map((c) => {
    const cny = tramosDe(c)[0]?.cny || yuanes(c.Price) || tramo0;
    return {
      opciones: Object.fromEntries((c.Configurators || []).map((x) => [x.Pid, x.Vid])),
      stock: Math.max(0, Number(c.Quantity) || 0),
      precioUsd: precioTienda(cny) ?? t.precioUsd,
      factor: tramo0 > 0 ? cny / tramo0 : 1,
    };
  });
  // Precio por tramo de cantidad (del producto); el de cada combinación se escala con su «factor».
  const tramosUsd = tramos.map((q) => ({ desde: q.desde, precioUsd: precioTienda(q.cny) }));
  const especificaciones = atributos.filter((x) => !x.IsConfigurator && x.Value)
    .map((x) => ({ nombre: mayuscula(texto(x.PropertyName || x.OriginalPropertyName, 80)), valor: texto(x.Value, 300) }))
    .filter((x, i, l) => l.findIndex((y) => y.nombre === x.nombre && y.valor === x.valor) === i).slice(0, 40);
  const descripcionFotos = [...String(item.Description || '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
    .map((m) => m[1].replace(/^\/\//, 'https://'))
    .filter((u) => /^https:\/\/[^/]*(alicdn\.com|1688\.com|taobaocdn\.com)\//i.test(u))
    .filter((u, i, l) => l.indexOf(u) === i).slice(0, 30);
  const video = (item.Videos || []).map((v) => v.Url).find((u) => /^https:\/\//.test(u || '')) || null;
  return {
    ...t,
    fotos: fotos.length ? fotos : [t.foto].filter(Boolean),
    video,
    tramos: tramosUsd,
    opciones,
    combinaciones,
    especificaciones,
    descripcionFotos,
    medidas,
    stock: Number(item.MasterQuantity) || null,
  };
}

/** Precio unitario para una combinación y cantidad (mismo cálculo que la ficha de la web). */
function precioPara(f, opciones, cantidad) {
  const combo = f.combinaciones.find((c) => Object.entries(c.opciones).every(([k, v]) => opciones[k] === v));
  let tramo = f.tramos[0];
  for (const t of f.tramos) if (t.desde <= cantidad) tramo = t;
  const factor = combo?.factor ?? 1;
  const precio = combo && factor !== 1 ? Math.max(0.01, Math.ceil(tramo.precioUsd * factor * 100 - 1e-6) / 100) : tramo.precioUsd;
  return { combo, precio };
}

/* ---------- rutas ---------- */

function registrar(app, { db }) {
  const { otapi, conCache } = crear(db);
  const lectura = rateLimit({ windowMs: 60 * 1000, limit: 90, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiadas consultas seguidas. Espera un momento.' } });
  const pedidos = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Demasiados pedidos seguidos. Intenta de nuevo en unos minutos.' } });
  const fallo = (res, e) => {
    if (!(e instanceof ErrorChina)) console.error(e);
    res.status(e instanceof ErrorChina ? e.status : 500).json({ error: e instanceof ErrorChina ? e.message : 'No se pudo consultar el catálogo de China.' });
  };
  const publico = (res, segundos) => res.setHeader('Cache-Control', `public, max-age=${segundos}, s-maxage=${segundos}`);

  const leerProducto = (id) => conCache(`p:${id}`, TTL.producto, async () => {
    const j = await otapi('GetItemFullInfo', { itemId: id });
    const f = ficha(j.OtapiItemFullInfo);
    if (!f) throw new ErrorChina('Este producto ya no está disponible.', 404);
    return { ...f, enlace: j.OtapiItemFullInfo.ExternalItemUrl || j.OtapiItemFullInfo.TaobaoItemUrl || null };
  });

  app.get('/api/web/china/estado', (req, res) => res.json({ activo: Boolean(clave()) }));

  app.get('/api/web/china/categorias', lectura, async (req, res) => {
    try {
      const lista = await conCache('categorias', TTL.categorias, async () => {
        const j = await otapi('GetRootCategoryInfoList', {});
        return (j.CategoryInfoList?.Content || [])
          .filter((c) => !c.IsHidden && CAT_VALIDA.test(c.Id || '') && c.Name)
          .map((c) => ({ id: c.Id, nombre: texto(c.Name, 80) }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      });
      publico(res, 3600);
      res.json(lista);
    } catch (e) { fallo(res, e); }
  });

  /** Una página de resultados (búsqueda por texto y/o categoría), guardada en caché. */
  const buscar = (q, categoria, pagina, tam = POR_PAGINA) => conCache(`b:${categoria}:${q.toLowerCase()}:${pagina}:${tam}`, TTL.buscar, async () => {
    const filtros = `<Provider>${PROVEEDOR}</Provider>${q ? `<ItemTitle>${xml(q)}</ItemTitle>` : ''}${categoria ? `<CategoryId>${categoria}</CategoryId>` : ''}`;
    const j = await otapi('SearchItemsFrame', { xmlParameters: `<SearchItemsParameters>${filtros}</SearchItemsParameters>`, framePosition: String((pagina - 1) * tam), frameSize: String(tam) });
    const total = Number(j.Result?.Items?.TotalCount) || 0;
    const paginas = Math.min(MAX_PAGINAS, Number(j.Result?.MaximumPageCount) || Math.ceil(total / tam), Math.ceil(total / tam));
    return { total, paginas, pagina, items: (j.Result?.Items?.Content || []).map(tarjeta).filter(Boolean) };
  });

  const secciones = () => {
    const propias = String(process.env.CHINA_SECCIONES || '').split(';').map((x) => x.split('|').map((y) => y.trim())).filter(([t, q]) => t && q);
    return (propias.length ? propias : SECCIONES).slice(0, 12);
  };

  // Solo la lista de filas (sin llamar a OTAPI): pedir las 8 búsquedas juntas tarda ~20 s, cada una sola ~4 s.
  app.get('/api/web/china/inicio', (req, res) => {
    publico(res, 600);
    res.json({ activo: Boolean(clave()), secciones: secciones().map(([titulo, q]) => ({ titulo, q })) });
  });

  app.get('/api/web/china/buscar', lectura, async (req, res) => {
    try {
      const q = texto(req.query.q, 80).replace(/\s+/g, ' ');
      const categoria = CAT_VALIDA.test(String(req.query.categoria || '')) ? String(req.query.categoria) : '';
      const pagina = Math.min(MAX_PAGINAS, Math.max(1, parseInt(req.query.pagina, 10) || 1));
      if (!q && !categoria) return res.status(400).json({ error: 'Escribe qué buscas o elige una categoría' });
      const r = await buscar(q, categoria, pagina, String(req.query.tam) === '12' ? 12 : POR_PAGINA);
      publico(res, 600);
      res.json(r);
    } catch (e) { fallo(res, e); }
  });

  app.get('/api/web/china/producto/:id', lectura, async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!ID_VALIDO.test(id)) return res.status(404).json({ error: 'Producto no encontrado' });
      const { enlace, ...f } = await leerProducto(id);
      publico(res, 600);
      res.json(f);
    } catch (e) { fallo(res, e); }
  });

  // El carrito completo llega como un solo encargo: el equipo compra en 1688, confirma flete y total por WhatsApp.
  app.post('/api/web/china/pedido', pedidos, async (req, res) => {
    try {
      const b = req.body || {};
      if (texto(b.sitioWeb, 200)) return res.status(201).json({ ok: true }); // trampa para bots
      const nombre = texto(b.nombre, 150);
      const telefono = texto(b.telefono, 50).replace(/[^\d+\-\s()]/g, '');
      const email = texto(b.email, 150).toLowerCase();
      if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre' });
      if (!telefono && !email) return res.status(400).json({ error: 'Déjanos un teléfono (WhatsApp) o un correo para confirmarte el pedido' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'El correo no es válido' });
      const pedidas = (Array.isArray(b.items) ? b.items : []).slice(0, MAX_LINEAS);
      if (!pedidas.length) return res.status(400).json({ error: 'Tu carrito está vacío' });

      const lineas = [];
      for (const it of pedidas) {
        const id = String(it?.id || '');
        if (!ID_VALIDO.test(id)) return res.status(400).json({ error: 'Hay un producto no válido en el carrito' });
        let f;
        try { f = await leerProducto(id); } catch (e) {
          if (e instanceof ErrorChina && e.status === 404) return res.status(400).json({ error: 'Un producto de tu carrito ya no está disponible. Quítalo e intenta de nuevo.' });
          throw e;
        }
        const elegidas = it.opciones && typeof it.opciones === 'object' ? it.opciones : {};
        const opciones = {};
        for (const o of f.opciones) {
          const v = o.valores.find((x) => x.id === elegidas[o.id]);
          if (!v) return res.status(400).json({ error: `Elige ${o.nombre.toLowerCase()} de «${f.titulo}»` });
          opciones[o.id] = v.id;
        }
        const cantidad = Math.min(1000000, Math.max(f.pedidoMinimo, parseInt(it.cantidad, 10) || 0));
        const { combo, precio } = precioPara(f, opciones, cantidad);
        if (combo && combo.stock > 0 && cantidad > combo.stock) return res.status(400).json({ error: `El fabricante tiene ${combo.stock} disponibles de «${f.titulo}» en esa opción` });
        const variante = f.opciones.map((o) => `${o.nombre}: ${o.valores.find((v) => v.id === opciones[o.id]).nombre}`).join(' · ');
        lineas.push({ id, titulo: f.titulo, variante, opciones, cantidad, precioUsd: precio, totalUsd: r2(precio * cantidad), fleteUsd: f.fleteUnidadUsd != null ? r2(f.fleteUnidadUsd * cantidad) : null, foto: f.foto, enlace: f.enlace });
      }
      const subtotal = r2(lineas.reduce((s, l) => s + l.totalUsd, 0));
      const conMedidas = lineas.filter((l) => l.fleteUsd != null);
      const flete = conMedidas.length ? r2(conMedidas.reduce((s, l) => s + l.fleteUsd, 0)) : null;
      const faltanMedidas = lineas.length - conMedidas.length;
      const descripcion = [
        `Pedido de la tienda (${lineas.length} ${lineas.length === 1 ? 'producto' : 'productos'}):`,
        ...lineas.map((l, i) => `${i + 1}. ${l.titulo}${l.variante ? ` — ${l.variante}` : ''}\n   ${l.cantidad} × $${l.precioUsd.toFixed(2)} = $${l.totalUsd.toFixed(2)}${l.enlace ? `\n   ${l.enlace}` : ''}`),
        `Subtotal: $${subtotal.toFixed(2)}`,
        `Flete marítimo estimado: ${flete != null ? `$${flete.toFixed(2)}` : 'por calcular'}${faltanMedidas && flete != null ? ` (sin contar ${faltanMedidas} producto(s) sin medidas)` : ''}`,
        texto(b.mensaje, 1000) && `Mensaje: ${texto(b.mensaje, 1000)}`,
      ].filter(Boolean).join('\n');
      const datos = JSON.stringify({
        enlaces: [...new Set(lineas.map((l) => l.enlace).filter(Boolean))],
        cantidad: `${lineas.reduce((s, l) => s + l.cantidad, 0)} unidades en ${lineas.length} producto(s)`,
        tienda: { lineas, subtotalUsd: subtotal, fleteEstimadoUsd: flete, faltanMedidas },
      });
      let nuevo;
      try {
        nuevo = (await db.query('INSERT INTO web_solicitudes(tipo,nombre,telefono,email,estado_venezuela,mensaje,datos) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['encargo', nombre, telefono || null, email || null, texto(b.estado, 80) || null, descripcion, datos])).rows[0].id;
      } catch (e) {
        if (e.code !== '23514') throw e; // sin la migración 20261105 (tipo «encargo»): se guarda como contacto
        nuevo = (await db.query('INSERT INTO web_solicitudes(tipo,nombre,telefono,email,estado_venezuela,mensaje,datos) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', ['contacto', nombre, telefono || null, email || null, texto(b.estado, 80) || null, `[Encargo] ${descripcion}`, null])).rows[0].id;
      }
      res.status(201).json({ ok: true, codigo: `ENC-${String(nuevo).padStart(4, '0')}`, subtotalUsd: subtotal, fleteEstimadoUsd: flete, faltanMedidas });
    } catch (e) { fallo(res, e); }
  });
}

module.exports = { ensureSchema, registrar, tarjeta, ficha, precioPara };
