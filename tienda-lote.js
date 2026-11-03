/**
 * Carga masiva de productos de la tienda desde Excel o CSV (solo administrador).
 *
 *   GET  /api/tienda/admin/lote/plantilla   → plantilla .xlsx con las columnas, ejemplos e instrucciones
 *   POST /api/tienda/admin/lote/analizar    → multipart `archivo`: lee y valida cada fila SIN guardar nada
 *   POST /api/tienda/admin/lote/aplicar     → { filas: [...] } (hasta 25 por llamada): crea o actualiza
 *
 * Una fila = un producto. Si ya existe uno con el mismo nombre (misma dirección/slug), se ACTUALIZA: precio, cupo,
 * textos… y sus variantes se emparejan por nombre (las que ya no vengan se desactivan, nunca se borran).
 * Las categorías que no existan se crean; el contenedor se busca por su número. Las fotos (enlaces) las trae el panel
 * después, producto por producto, con la ruta de fotos remotas (solo dominios de mercados chinos).
 * Se aplica por tandas desde el panel para no pasar el límite de 30 s de Vercel.
 */
const multer = require('multer');
const XLSX = require('xlsx');

const MAX_FILAS = 1000;
const POR_TANDA = 25;
const subir = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 5 * 1024 * 1024 } });

/** Columnas de la plantilla y nombres alternativos aceptados (se comparan sin tildes, mayúsculas ni signos). */
const COLUMNAS = [
  { k: 'nombre', titulo: 'Nombre', req: true, alias: ['nombre', 'producto', 'nombre del producto', 'titulo', 'name'] },
  { k: 'categoria', titulo: 'Categoría', alias: ['categoria', 'category', 'rubro'] },
  { k: 'precio', titulo: 'Precio USD', req: true, alias: ['precio usd', 'precio', 'precio de venta', 'precio venta', 'price'] },
  { k: 'precioAntes', titulo: 'Precio anterior USD', alias: ['precio anterior usd', 'precio anterior', 'precio antes', 'precio tachado', 'antes'] },
  { k: 'tipoVariante', titulo: 'Tipo de variante', alias: ['tipo de variante', 'tipo variante', 'nombre de la variante', 'nombre variante'] },
  { k: 'variantes', titulo: 'Variantes', alias: ['variantes', 'variante', 'opciones', 'colores', 'modelos', 'tallas'] },
  { k: 'cupo', titulo: 'Cupo', alias: ['cupo', 'cupos', 'stock', 'unidades', 'cantidad'] },
  { k: 'preciosVariante', titulo: 'Precio por variante USD', alias: ['precio por variante usd', 'precio por variante', 'precios por variante', 'precios variantes'] },
  { k: 'skus', titulo: 'SKU', alias: ['sku', 'skus', 'codigo', 'codigos', 'referencia'] },
  { k: 'contenedor', titulo: 'Contenedor', alias: ['contenedor', 'numero de contenedor', 'container'] },
  { k: 'origen', titulo: 'Origen', alias: ['origen', 'ciudad de origen', 'ciudad'] },
  { k: 'descripcion', titulo: 'Descripción', alias: ['descripcion', 'description'] },
  { k: 'especificaciones', titulo: 'Especificaciones', alias: ['especificaciones', 'caracteristicas', 'specs', 'ficha tecnica'] },
  { k: 'fotos', titulo: 'Fotos (enlaces)', alias: ['fotos enlaces', 'fotos', 'foto', 'imagenes', 'imagen', 'images'] },
  { k: 'fuente', titulo: 'Enlace de origen', alias: ['enlace de origen', 'enlace', 'url', 'link', 'fuente', 'enlace 1688'] },
  { k: 'publicar', titulo: 'Publicar (sí/no)', alias: ['publicar si no', 'publicar', 'publicado', 'activo', 'visible'] },
  { k: 'orden', titulo: 'Orden', alias: ['orden', 'posicion'] },
];

const EJEMPLOS = [
  ['Freidora de aire 5,5 L', 'Electro', 79, 95, 'Color', 'Negro | Blanco', '20 | 8', '', 'FRE-55-N | FRE-55-B', 'TGHU-4410273', 'Foshan, China', 'Cesta antiadherente de 5,5 litros.\nPanel digital con 8 programas.', '1700 W, 110 V | 80–200 °C', '', '', 'sí', 1],
  ['Juego de ollas 10 piezas', 'Hogar', 54, '', 'Presentación', '10 piezas | 6 piezas', '15 | 10', '54 | 39', '', 'TGHU-4410273', 'Chaozhou, China', 'Acero inoxidable con fondo triple capa.', 'Acero 18/10 | Tapas de vidrio', '', '', 'no', 2],
];

const INSTRUCCIONES = [
  ['Carga masiva de la tienda: una fila por producto'],
  [''],
  ['Obligatorias: Nombre y Precio USD. Las demás columnas son opcionales y pueden ir en cualquier orden.'],
  ['Si el nombre coincide con un producto que ya existe, se ACTUALIZA (precio, cupo, textos, variantes). Si no, se crea.'],
  ['Variantes: separadas por | (por ejemplo «Negro | Blanco»). Sin variantes, el producto queda con una variante «Única».'],
  ['Cupo: unidades que caben en el contenedor. Un número para todas las variantes, o uno por variante separado por | en el mismo orden.'],
  ['Precio por variante USD: opcional, uno por variante separado por |; vacío = el precio del producto.'],
  ['Categoría: si no existe, se crea. Contenedor: su número tal como está en el panel (por ejemplo TGHU-4410273).'],
  ['Descripción: un párrafo por línea (Alt+Enter en Excel). Especificaciones: separadas por | o una por línea.'],
  ['Fotos (enlaces): enlaces de fotos de 1688, Alibaba, Taobao o Yiwugo separados por |. Solo se agregan si el producto no tiene fotos.'],
  ['Publicar: sí / no. Si lo dejas vacío queda sin publicar (borrador) para revisarlo en el panel.'],
  ['Las filas con errores se informan con su número de fila y no frenan a las demás.'],
];

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const texto = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const partes = (v) => String(v ?? '').split(/\s*\|\s*/).map((x) => x.trim()).filter(Boolean);
const numero = (v) => {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/[$\s]/g, '');
  // «1.234,50» o «1,234.50» o «12,5»
  const normal = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
};
const siNo = (v) => /^(si|sí|s|yes|y|1|true|x|publicado|activo)$/i.test(String(v ?? '').trim());

function leerHoja(buffer, nombre) {
  const esCsv = /\.csv$/i.test(nombre || '');
  const wb = esCsv ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true }) : XLSX.read(buffer, { type: 'buffer' });
  // La hoja de productos: la que se llame «Productos» o la primera.
  const hoja = wb.Sheets[wb.SheetNames.find((n) => sinTildes(n) === 'productos') || wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', blankrows: false, raw: true });
}

/** Encuentra la fila de encabezados (la primera que tenga «Nombre» y «Precio») y asigna cada columna a su campo. */
function mapearEncabezados(filas) {
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const mapa = {};
    filas[i].forEach((celda, col) => {
      const t = sinTildes(celda);
      const c = COLUMNAS.find((x) => x.alias.includes(t));
      if (c && mapa[c.k] == null) mapa[c.k] = col;
    });
    if (mapa.nombre != null && mapa.precio != null) return { inicio: i + 1, mapa };
  }
  return null;
}

/** Convierte una fila del Excel en los datos de un producto (los mismos que manda el formulario) y sus errores. */
function filaAProducto(celdas, mapa) {
  const v = (k) => (mapa[k] == null ? '' : celdas[mapa[k]]);
  const errores = [];
  const nombre = texto(v('nombre'), 150);
  const precio = numero(v('precio'));
  const antes = numero(v('precioAntes'));
  if (!nombre) errores.push('Falta el nombre');
  if (!(precio > 0)) errores.push('El precio debe ser un número mayor que cero');
  if (antes != null && !(antes > precio)) errores.push('El precio anterior debe ser mayor que el precio');

  const nombresVar = partes(v('variantes')).slice(0, 20);
  const listaVar = nombresVar.length ? nombresVar : ['Única'];
  const cupos = partes(v('cupo')).map(numero);
  const precios = partes(v('preciosVariante')).map(numero);
  const skus = partes(v('skus'));
  if (cupos.some((c) => !Number.isInteger(c) || c < 0)) errores.push('El cupo debe ser un número entero (0 o más)');
  if (cupos.length > 1 && cupos.length !== listaVar.length) errores.push(`Hay ${listaVar.length} variante(s) y ${cupos.length} cupos: pon uno por variante o uno solo para todas`);
  if (precios.length && precios.length !== listaVar.length) errores.push(`Hay ${listaVar.length} variante(s) y ${precios.length} precios por variante`);
  if (precios.some((p) => !(p > 0))) errores.push('Los precios por variante deben ser números mayores que cero');

  const fotos = partes(v('fotos')).filter((u) => /^https:\/\//i.test(u)).slice(0, 8);
  const lineas = (x) => String(x ?? '').split(/\r?\n|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const datos = {
    nombre,
    precioUsd: precio,
    precioAntesUsd: antes ?? '',
    nombreVariante: texto(v('tipoVariante'), 40) || 'Presentación',
    variantes: listaVar.map((n, i) => ({ nombre: texto(n, 80), sku: texto(skus[i], 60), cupo: cupos.length === 1 ? cupos[0] : cupos[i] ?? 0, precioUsd: precios[i] ?? null })),
    origen: texto(v('origen'), 120),
    descripcion: String(v('descripcion') ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    especificaciones: lineas(v('especificaciones')),
    activo: siNo(v('publicar')),
    orden: Number.isInteger(numero(v('orden'))) ? numero(v('orden')) : 0,
    ...(texto(v('fuente'), 600) ? { fuenteUrl: texto(v('fuente'), 600) } : {}),
  };
  return { datos, categoria: texto(v('categoria'), 80), contenedor: texto(v('contenedor'), 100), fotos, errores };
}

function registrar(app, { db, auth, logAction, persistirProducto, slugDe }) {
  const soloAdmin = (req, res) => {
    if (req.user.rol === 'admin') return true;
    res.status(403).json({ error: 'Solo el administrador' });
    return false;
  };

  app.get('/api/tienda/admin/lote/plantilla', auth, (req, res) => {
    if (!soloAdmin(req, res)) return;
    const wb = XLSX.utils.book_new();
    const hoja = XLSX.utils.aoa_to_sheet([COLUMNAS.map((c) => c.titulo), ...EJEMPLOS]);
    hoja['!cols'] = COLUMNAS.map((c) => ({ wch: Math.max(12, c.titulo.length + 2) }));
    XLSX.utils.book_append_sheet(wb, hoja, 'Productos');
    const inst = XLSX.utils.aoa_to_sheet(INSTRUCCIONES);
    inst['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, inst, 'Instrucciones');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-tienda-criollo-cargo.xlsx"');
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  });

  app.post('/api/tienda/admin/lote/analizar', auth, (req, res, next) => subir.single('archivo')(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo debe pesar menos de 5 MB' : 'No se pudo recibir el archivo' }) : next())), async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const f = req.file;
      if (!f) return res.status(400).json({ error: 'Sube el archivo Excel (.xlsx) o CSV' });
      const esZip = f.buffer.length > 4 && f.buffer[0] === 0x50 && f.buffer[1] === 0x4b; // .xlsx es un ZIP
      if (!esZip && !/\.csv$/i.test(f.originalname || '')) return res.status(400).json({ error: 'El archivo debe ser .xlsx o .csv' });
      let filas;
      try { filas = leerHoja(f.buffer, f.originalname); } catch { return res.status(400).json({ error: 'No se pudo leer el archivo. Guárdalo como .xlsx o .csv y vuelve a intentar.' }); }
      const enc = mapearEncabezados(filas);
      if (!enc) return res.status(400).json({ error: 'No se encontraron las columnas «Nombre» y «Precio USD». Usa la plantilla.' });
      const cuerpo = filas.slice(enc.inicio).filter((c) => c.some((x) => String(x).trim() !== ''));
      if (cuerpo.length > MAX_FILAS) return res.status(400).json({ error: `Máximo ${MAX_FILAS} productos por archivo` });

      const existentes = new Map((await db.query('SELECT id, slug FROM tienda_productos')).rows.map((p) => [p.slug, String(p.id)]));
      const categorias = new Set((await db.query('SELECT LOWER(nombre) AS n FROM tienda_categorias')).rows.map((c) => c.n));
      const contenedores = new Set((await db.query('SELECT UPPER(numero) AS n FROM contenedores')).rows.map((c) => c.n));
      const vistos = new Map();
      const resultado = cuerpo.map((celdas, i) => {
        const fila = enc.inicio + i + 1; // número de fila tal como se ve en Excel
        const p = filaAProducto(celdas, enc.mapa);
        const slug = slugDe(p.datos.nombre);
        if (slug && vistos.has(slug)) p.errores.push(`Repite el nombre de la fila ${vistos.get(slug)}`);
        else if (slug) vistos.set(slug, fila);
        if (p.contenedor && !contenedores.has(p.contenedor.toUpperCase())) p.errores.push(`No existe el contenedor «${p.contenedor}» en el panel`);
        const avisos = [];
        if (p.categoria && !categorias.has(p.categoria.toLowerCase())) avisos.push(`Se creará la categoría «${p.categoria}»`);
        if (p.datos.activo && p.datos.variantes.every((v) => !v.cupo)) avisos.push('Se publica sin cupo: aparecerá agotado');
        return { fila, accion: existentes.has(slug) ? 'actualizar' : 'crear', ...p, avisos };
      });
      res.json({
        columnas: Object.keys(enc.mapa).map((k) => COLUMNAS.find((c) => c.k === k).titulo),
        filas: resultado,
        resumen: { total: resultado.length, validas: resultado.filter((r) => !r.errores.length).length, crear: resultado.filter((r) => !r.errores.length && r.accion === 'crear').length, actualizar: resultado.filter((r) => !r.errores.length && r.accion === 'actualizar').length },
        porTanda: POR_TANDA,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo analizar el archivo' });
    }
  });

  app.post('/api/tienda/admin/lote/aplicar', auth, async (req, res) => {
    try {
      if (!soloAdmin(req, res)) return;
      const filas = Array.isArray(req.body?.filas) ? req.body.filas.slice(0, POR_TANDA) : [];
      if (!filas.length) return res.status(400).json({ error: 'No hay filas para cargar' });
      const resultados = [];
      for (const f of filas) {
        try {
          const datos = { ...(f.datos || {}) };
          // Categoría: la existente con ese nombre (sin distinguir mayúsculas) o una nueva.
          if (f.categoria) {
            const nombreCat = texto(f.categoria, 80);
            let c = (await db.query('SELECT id FROM tienda_categorias WHERE LOWER(nombre)=LOWER($1)', [nombreCat])).rows[0];
            if (!c) {
              const slugCat = slugDe(nombreCat) || `categoria-${Date.now()}`;
              c = (await db.query('SELECT id FROM tienda_categorias WHERE slug=$1', [slugCat])).rows[0]
                || (await db.query('INSERT INTO tienda_categorias(nombre,slug,orden) VALUES($1,$2,99) RETURNING id', [nombreCat, slugCat])).rows[0];
            }
            datos.categoriaId = String(c.id);
          }
          if (f.contenedor) {
            const k = (await db.query('SELECT id FROM contenedores WHERE UPPER(numero)=UPPER($1)', [texto(f.contenedor, 100)])).rows[0];
            if (!k) { resultados.push({ fila: f.fila, ok: false, error: `No existe el contenedor «${f.contenedor}»` }); continue; }
            datos.contenedorId = String(k.id);
          }
          // ¿Ya existe? Se actualiza, conservando los ids de las variantes que se llamen igual.
          const slug = slugDe(texto(datos.nombre, 150));
          const actual = slug ? (await db.query('SELECT id, categoria_id, contenedor_id FROM tienda_productos WHERE slug=$1', [slug])).rows[0] : null;
          if (actual) {
            const vars = (await db.query('SELECT id, nombre FROM tienda_variantes WHERE producto_id=$1', [actual.id])).rows;
            datos.variantes = (datos.variantes || []).map((v) => ({ ...v, id: vars.find((x) => x.nombre.toLowerCase() === String(v.nombre).toLowerCase())?.id }));
            // Celdas vacías no borran lo que ya tenía.
            if (!f.categoria && actual.categoria_id) datos.categoriaId = String(actual.categoria_id);
            if (!f.contenedor && actual.contenedor_id) datos.contenedorId = String(actual.contenedor_id);
          }
          const r = await persistirProducto(datos, actual ? Number(actual.id) : null, req.user.id);
          if (r.status >= 400) { resultados.push({ fila: f.fila, ok: false, error: r.body.error }); continue; }
          const nFotos = Number((await db.query('SELECT COUNT(*) AS n FROM tienda_imagenes WHERE producto_id=$1', [Number(r.body.id)])).rows[0]?.n || 0);
          resultados.push({ fila: f.fila, ok: true, id: r.body.id, accion: actual ? 'actualizado' : 'creado', traerFotos: nFotos === 0 && Array.isArray(f.fotos) && f.fotos.length > 0, aviso: r.body.aviso });
        } catch (e) {
          console.error('Carga masiva, fila', f.fila, e.message);
          resultados.push({ fila: f.fila, ok: false, error: 'Error al guardar esta fila' });
        }
      }
      const hechas = resultados.filter((r) => r.ok).length;
      if (hechas) await logAction(req.user.id, 'Carga masiva de la tienda', 'tienda_productos', null, `${hechas} producto(s) cargados desde Excel.`);
      res.json({ resultados });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'No se pudo cargar la tanda' });
    }
  });
}

module.exports = { registrar, filaAProducto, mapearEncabezados, COLUMNAS };
