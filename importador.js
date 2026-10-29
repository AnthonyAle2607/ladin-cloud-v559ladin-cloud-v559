/**
 * Importador de datos existentes (clientes, contenedores y etiquetas) desde Excel o CSV, sin reescribir nada a mano.
 *
 *   POST /api/importar/analizar   archivo + tipo → encabezados, mapeo sugerido y vista previa (no guarda nada)
 *   POST /api/importar/aplicar    archivo + tipo + mapeo + opciones → simulacro (simular=1) o carga real
 *
 * Solo el administrador. Los códigos de cliente se conservan tal cual vienen (por ejemplo «2-W2089S»).
 * Cada fila se valida por separado: las malas se informan con su número de fila y no frenan a las buenas.
 */
const multer = require('multer');
const XLSX = require('xlsx');

const MAX_FILAS = 5000;
const MAX_BYTES = 10 * 1024 * 1024;

// Campos de cada tipo. `alias` son nombres de columna habituales (se comparan sin tildes, mayúsculas ni signos).
const TIPOS = {
  clientes: {
    etiqueta: 'Clientes',
    clave: 'code',
    campos: {
      code: { titulo: 'Código de cliente', alias: ['codigo cliente', 'codigo de cliente', 'cod cliente', 'codigo', 'code', 'id cliente', 'nro cliente'] },
      name: { titulo: 'Nombre', requerido: true, alias: ['nombre', 'nombres', 'cliente', 'nombre completo', 'razon social', 'name'] },
      surname: { titulo: 'Apellido', alias: ['apellido', 'apellidos', 'surname'] },
      idNumber: { titulo: 'Cédula / RIF', alias: ['cedula', 'cedula de identidad', 'ci', 'c i', 'rif', 'cedula rif', 'cedula o rif', 'documento', 'identificacion', 'nro documento', 'dni'] },
      phone: { titulo: 'Teléfono', alias: ['telefono', 'tlf', 'celular', 'movil', 'whatsapp', 'phone', 'n de contacto', 'no de contacto'] },
      email: { titulo: 'Correo', alias: ['correo', 'email', 'e mail', 'correo electronico'] },
      company: { titulo: 'Empresa', alias: ['empresa', 'compania', 'company', 'negocio'] },
      advisor: { titulo: 'Código o nombre del asesor', alias: ['asesor', 'asesora', 'codigo asesor', 'codigo asesora', 'codigo vendedor', 'codigo del vendedor', 'vendedor', 'advisor'] },
      state: { titulo: 'Estado de Venezuela', alias: ['estado venezuela', 'estado', 'ubicacion', 'direccion', 'destino'] },
      firstContact: { titulo: 'Fecha de primer contacto', alias: ['primer contacto', 'fecha primer contacto', 'fecha de primer contacto', 'fecha contacto'] },
      notes: { titulo: 'Observaciones', alias: ['observaciones', 'notas', 'nota', 'comentarios', 'notes'] },
    },
  },
  contenedores: {
    etiqueta: 'Contenedores',
    clave: 'number',
    campos: {
      number: { titulo: 'Número de contenedor', requerido: true, alias: ['numero', 'contenedor', 'codigo contenedor', 'nro contenedor', 'container', 'numero contenedor'] },
      origin: { titulo: 'Origen', alias: ['origen', 'origin', 'puerto origen'] },
      departure: { titulo: 'Fecha de salida (ATD)', alias: ['salida', 'fecha salida', 'zarpe', 'atd', 'fecha de salida'] },
      eta: { titulo: 'Llegada estimada (ETA)', alias: ['eta', 'llegada estimada', 'fecha estimada', 'fecha eta'] },
      arrival: { titulo: 'Fecha de llegada', alias: ['llegada', 'fecha llegada', 'fecha de llegada', 'arribo'] },
      status: { titulo: 'Estado', alias: ['estado', 'status', 'situacion'] },
      notes: { titulo: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
    },
  },
  etiquetas: {
    etiqueta: 'Etiquetas',
    clave: 'number',
    campos: {
      number: { titulo: 'Número de etiqueta', requerido: true, alias: ['numero', 'etiqueta', 'nro etiqueta', 'codigo etiqueta', 'numero etiqueta', 'label'] },
      clientCode: { titulo: 'Código de cliente', requerido: true, alias: ['codigo cliente', 'codigo de cliente', 'cod cliente', 'cliente', 'codigo'] },
      container: { titulo: 'Número de contenedor', alias: ['contenedor', 'codigo contenedor', 'nro contenedor', 'numero contenedor', 'container'] },
      cargoType: { titulo: 'Tipo de mercancía', alias: ['mercancia', 'tipo mercancia', 'tipo de mercancia', 'descripcion', 'producto'] },
      boxesPacking: { titulo: 'Cajas del packing list', alias: ['cajas packing', 'cajas packing list', 'cajas totales', 'cajas', 'cantidad de cajas'] },
      boxesChina: { titulo: 'Cajas en almacén', alias: ['cajas almacen', 'cajas en almacen', 'cajas china', 'cajas en china', 'cajas recibidas'] },
      cbmPacking: { titulo: 'CBM del packing list', alias: ['cbm packing', 'cbm packing list', 'cbm', 'volumen'] },
      cbmChina: { titulo: 'CBM real en almacén', alias: ['cbm real', 'cbm china', 'cbm real china', 'cbm almacen'] },
      status: { titulo: 'Estado', alias: ['estado', 'status', 'situacion'] },
      notes: { titulo: 'Observaciones', alias: ['observaciones', 'notas', 'comentarios'] },
    },
  },
};

const ESTADOS_CLIENTE = { 'por atender': 'pending', pendiente: 'pending', pending: 'pending', atendiendo: 'process', 'en proceso': 'process', process: 'process', atendido: 'done', done: 'done', inactivo: 'inactive', inactive: 'inactive' };
const ESTADOS_ENVIO = { preparando: 'prep', prep: 'prep', 'en transito': 'transit', transito: 'transit', transit: 'transit', 'en venezuela': 've', venezuela: 've', ve: 've', facturado: 'facturado', entregado: 'done', done: 'done', cerrado: 'closed', closed: 'closed' };

/* ---------- utilidades ---------- */

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const celda = (v) => (v instanceof Date ? v : v == null ? '' : String(v).trim());

function numero(v) {
  if (v === '' || v == null) return null;
  const s = String(v).trim().replace(/\s/g, '');
  const n = Number(/,\d{1,3}$/.test(s) && !/\.\d{3}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** Acepta AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, fechas de Excel y objetos Date. Devuelve AAAA-MM-DD, '' o null (inválida). */
function fechaIso(v) {
  if (v === '' || v == null) return '';
  const pad = (n) => String(n).padStart(2, '0');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
  function valida(y, mo, d) {
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
}

function leerArchivo(buffer, nombre) {
  const esCsv = /\.(csv|txt)$/i.test(nombre || '');
  // Los CSV se leen como texto UTF-8 (con o sin BOM) para no romper tildes ni la ñ, y SIN que la librería adivine tipos
  // (raw: true): si no, «2-15» se vuelve fecha, «3,65» se vuelve 365 y una fecha ISO se corre un día.
  // sheetRows limita cuánto se materializa de una hoja (defensa contra archivos que declaran millones de filas).
  const limites = { sheetRows: MAX_FILAS + 200, bookVBA: false, cellFormula: false, cellStyles: false, cellHTML: false };
  const wb = esCsv ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true, ...limites }) : XLSX.read(buffer, { type: 'buffer', cellDates: true, ...limites });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  if (!hoja) throw new Error('El archivo no tiene hojas');
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', blankrows: false, raw: true });
  // El encabezado es la primera fila con al menos 2 celdas llenas (los formatos de la empresa traen títulos arriba).
  const iEnc = filas.findIndex((f) => f.filter((c) => String(c).trim() !== '').length >= 2);
  if (iEnc < 0) throw new Error('No encontré encabezados en el archivo');
  const encabezados = filas[iEnc].map((c, i) => String(c).trim() || `Columna ${i + 1}`);
  const datos = filas.slice(iEnc + 1).filter((f) => f.some((c) => String(c).trim() !== ''));
  if (datos.length > MAX_FILAS) throw new Error(`El archivo tiene ${datos.length} filas; el máximo por carga es ${MAX_FILAS}. Divídelo en partes.`);
  return { encabezados, filas: datos, filaInicial: iEnc + 2, hoja: wb.SheetNames[0], hojas: wb.SheetNames };
}

function sugerirMapeo(tipo, encabezados) {
  const usados = new Set();
  const mapeo = {};
  const normEnc = encabezados.map(norm);
  for (const [campo, def] of Object.entries(TIPOS[tipo].campos)) {
    for (const a of def.alias) {
      const i = normEnc.findIndex((h, k) => !usados.has(k) && h === a);
      if (i >= 0) { mapeo[campo] = encabezados[i]; usados.add(i); break; }
    }
  }
  return mapeo;
}

/** Fila cruda → objeto { campo: valor } según el mapeo { campo: nombreDeColumna }. */
function aplicarMapeo(encabezados, fila, mapeo) {
  const out = {};
  for (const [campo, col] of Object.entries(mapeo)) {
    const i = encabezados.indexOf(col);
    if (i >= 0) out[campo] = celda(fila[i]);
  }
  return out;
}

/* ---------- rutas ---------- */

function registrar(app, { db, auth, logAction, intId }) {
  const subir = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_BYTES } });
  const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede importar datos' }));
  const recibir = (req, res, next) => subir.single('archivo')(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10 MB' : 'No se pudo leer el archivo' }) : next()));

  const abrir = (req, res) => {
    const tipo = String(req.body?.tipo || '');
    if (!TIPOS[tipo]) { res.status(400).json({ error: 'Elige qué vas a importar' }); return null; }
    if (!req.file) { res.status(400).json({ error: 'Adjunta un archivo Excel o CSV' }); return null; }
    if (!/\.(xlsx|xls|csv|txt)$/i.test(req.file.originalname || '')) { res.status(400).json({ error: 'Formato no admitido: usa .xlsx, .xls o .csv' }); return null; }
    try { return { tipo, ...leerArchivo(req.file.buffer, req.file.originalname) }; } catch (e) { res.status(400).json({ error: e.message || 'No se pudo leer el archivo' }); return null; }
  };

  app.get('/api/importar/campos', auth, soloAdmin, (req, res) => {
    res.json(Object.fromEntries(Object.entries(TIPOS).map(([t, d]) => [t, { label: d.etiqueta, fields: Object.entries(d.campos).map(([id, c]) => ({ id, label: c.titulo, required: !!c.requerido })) }])));
  });

  app.post('/api/importar/analizar', auth, soloAdmin, recibir, (req, res) => {
    const a = abrir(req, res);
    if (!a) return;
    const mapeo = sugerirMapeo(a.tipo, a.encabezados);
    res.json({
      type: a.tipo, sheet: a.hoja, headers: a.encabezados, mapping: mapeo, totalRows: a.filas.length,
      preview: a.filas.slice(0, 8).map((f) => a.encabezados.map((_, i) => { const c = celda(f[i]); return c instanceof Date ? fechaIso(c) : c; })),
    });
  });

  const aplicarHandler = async (req, res) => {
    const a = abrir(req, res);
    if (!a) return;
    let tx = null;
    try {
      let mapeo;
      try { mapeo = JSON.parse(req.body.mapeo || '{}'); } catch { return res.status(400).json({ error: 'El mapeo de columnas no es válido' }); }
      const def = TIPOS[a.tipo];
      for (const [campo, d] of Object.entries(def.campos)) if (d.requerido && !mapeo[campo]) return res.status(400).json({ error: `Falta indicar la columna de «${d.titulo}»` });
      for (const col of Object.values(mapeo)) if (col && !a.encabezados.includes(col)) return res.status(400).json({ error: `La columna «${col}» no existe en el archivo` });
      const simular = req.body.simular === '1' || req.body.simular === 'true';
      const actualizar = req.body.modo === 'actualizar';
      const asesoraDefecto = intId(req.body.asesoraDefecto) || req.user.id;

      const r = { created: 0, updated: 0, skipped: 0, errors: [], warnings: [] };
      const falla = (fila, motivo) => r.errors.push({ row: fila, reason: motivo });

      // Catálogos para resolver referencias por código o nombre.
      const asesores = (await db.query("SELECT id,nombre,codigo_asesora FROM usuarios WHERE activo=TRUE")).rows;
      const asesorPor = (v) => { const k = norm(v); return k ? asesores.find((u) => norm(u.codigo_asesora) === k || norm(u.nombre) === k) : null; };
      const clientesFilas = (await db.query('SELECT id,codigo_cliente,nombre,apellido,telefono,email FROM clientes')).rows;
      const clientes = new Map(clientesFilas.filter((c) => c.codigo_cliente).map((c) => [c.codigo_cliente.toLowerCase(), c.id]));
      // Clientes sin código en el archivo: se reconocen por nombre + teléfono/correo para no duplicarlos al repetir la carga.
      const huella = (nombre, contacto) => `${norm(nombre)}|${norm(contacto)}`;
      const clientesPorHuella = new Map(clientesFilas.map((c) => [huella([c.nombre, c.apellido].filter(Boolean).join(' '), c.email || c.telefono || ''), c.id]));
      const contenedores = new Map((await db.query('SELECT id,numero FROM contenedores')).rows.map((c) => [c.numero.toLowerCase(), c.id]));
      const etiquetas = new Map((await db.query('SELECT id,numero FROM etiquetas')).rows.map((e) => [e.numero.toLowerCase(), e.id]));
      const vistos = new Set();

      tx = await db.connect();
      await tx.query('BEGIN');
      for (const [n, cruda] of a.filas.entries()) {
        const fila = a.filaInicial + n;
        const v = aplicarMapeo(a.encabezados, cruda, mapeo);
        const clave = String(v[def.clave] ?? '').trim();
        if (def.campos[def.clave].requerido && !clave) { falla(fila, `Falta ${def.campos[def.clave].titulo.toLowerCase()}`); continue; }
        if (a.tipo !== 'clientes' && !clave) continue;
        if (clave) {
          const k = `${a.tipo}:${clave.toLowerCase()}`;
          if (vistos.has(k)) { falla(fila, `«${clave}» está repetido en el archivo`); continue; }
          vistos.add(k);
        }
        try {
          if (a.tipo === 'clientes') await importarCliente({ tx, v, fila, falla, r, clientes, clientesPorHuella, huella, asesorPor, asesoraDefecto, actualizar, clave });
          else if (a.tipo === 'contenedores') await importarContenedor({ tx, v, fila, falla, r, contenedores, actualizar, clave });
          else await importarEtiqueta({ tx, v, fila, falla, r, clientes, contenedores, etiquetas, actualizar, clave });
        } catch (e) {
          console.error(`Importación, fila ${fila}:`, e.message);
          falla(fila, 'No se pudo guardar esta fila');
        }
      }
      await tx.query(simular ? 'ROLLBACK' : 'COMMIT');
      if (!simular) await logAction(req.user.id, `Importación de ${def.etiqueta.toLowerCase()}`, a.tipo, 0, `${r.created} creado(s), ${r.updated} actualizado(s), ${r.skipped} omitido(s), ${r.errors.length} con error. Archivo: ${String(req.file.originalname).slice(0, 80)}.`);
      res.json({ simulated: simular, ...r, errors: r.errors.slice(0, 200), errorCount: r.errors.length });
    } catch (e) {
      if (tx) await tx.query('ROLLBACK').catch(() => {});
      console.error(e);
      res.status(500).json({ error: 'No se pudo completar la importación' });
    } finally {
      if (tx && typeof tx.release === 'function') tx.release(); // devolver la conexión al pool (con Supabase el pool es pequeño)
    }
  };

  app.post('/api/importar/aplicar', auth, soloAdmin, recibir, aplicarHandler);

  /** Ruta que ya llamaba el botón «Importar clientes desde Excel» de la web: campo `file`, responde inserted/updated/skipped. */
  app.post('/api/admin/import-clients', auth, soloAdmin, (req, res, next) => subir.single('file')(req, res, (e) => (e ? res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera 10 MB' : 'No se pudo leer el archivo' }) : next())), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Selecciona un archivo' });
    let a;
    try { a = leerArchivo(req.file.buffer, req.file.originalname); } catch (e) { return res.status(400).json({ error: e.message || 'No se pudo leer el archivo' }); }
    const mapeo = sugerirMapeo('clientes', a.encabezados);
    if (!mapeo.name) return res.status(400).json({ error: 'No encontré la columna del nombre del cliente. Usa un encabezado como «Nombre» o «Cliente» (o usa Importar datos, que deja elegir las columnas).' });
    req.body = { tipo: 'clientes', mapeo: JSON.stringify(mapeo), modo: 'actualizar' };
    const responder = res.json.bind(res);
    res.json = (d) => responder(d && d.simulated !== undefined ? { inserted: d.created, updated: d.updated, skipped: d.skipped, errors: d.errors, errorCount: d.errorCount, warnings: d.warnings } : d);
    return aplicarHandler(req, res);
  });
}

/* ---------- una fila de cada tipo ---------- */

async function importarCliente({ tx, v, fila, falla, r, clientes, clientesPorHuella, huella, asesorPor, asesoraDefecto, actualizar, clave }) {
  const nombreCompleto = [v.name, v.surname].filter(Boolean).join(' ').trim();
  if (!nombreCompleto) return falla(fila, 'Falta el nombre');
  const partes = nombreCompleto.split(/\s+/);
  const nombre = partes.shift().slice(0, 150), apellido = partes.join(' ').slice(0, 150) || null;
  const primer = fechaIso(v.firstContact);
  if (primer === null) return falla(fila, 'La fecha de primer contacto no es válida (usa AAAA-MM-DD o DD/MM/AAAA)');
  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return falla(fila, 'El correo no es válido');
  let cedula = null;
  if (v.idNumber) {
    const t = String(v.idNumber).trim();
    if (!/^[A-Za-z0-9.\-\s]{3,30}$/.test(t)) return falla(fila, 'La cédula o RIF no es válida (solo letras, números, puntos y guiones)');
    cedula = t.replace(/\s+/g, ' ').toUpperCase();
  }
  let asesoraId = asesoraDefecto;
  if (v.advisor) {
    const u = asesorPor(v.advisor);
    if (u) asesoraId = u.id; else r.warnings.push({ row: fila, reason: `No encontré al asesor «${v.advisor}»; se asignó al asesor por defecto` });
  }
  const datos = [nombre, apellido, v.phone ? String(v.phone).slice(0, 50) : null, v.email || null, v.company ? String(v.company).slice(0, 200) : null, asesoraId, v.state ? String(v.state).slice(0, 80) : null, primer || null, v.notes ? String(v.notes) : null];
  const claveHuella = huella(nombreCompleto, v.email || v.phone || '');
  const existente = clave ? clientes.get(clave.toLowerCase()) : clientesPorHuella.get(claveHuella);
  if (existente) {
    if (!actualizar) { r.skipped++; return; }
    await tx.query('UPDATE clientes SET nombre=$1,apellido=$2,telefono=COALESCE($3,telefono),email=COALESCE($4,email),empresa=COALESCE($5,empresa),asesora_id=$6,estado_venezuela=COALESCE($7,estado_venezuela),fecha_primer_contacto=COALESCE($8,fecha_primer_contacto),observaciones=COALESCE($9,observaciones),cedula=COALESCE($10,cedula),fecha_actualizacion=CURRENT_TIMESTAMP WHERE id=$11', [...datos, cedula, existente]);
    r.updated++;
    return;
  }
  const ins = await tx.query(`INSERT INTO clientes(nombre,apellido,telefono,email,empresa,asesora_id,estado_venezuela,fecha_primer_contacto,observaciones,codigo_cliente,estado,cedula) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) RETURNING id`, [...datos, clave ? clave.slice(0, 50) : null, cedula]);
  const id = ins.rows[0].id;
  if (!clave) {
    const codigo = `LC-CLI-${String(id).padStart(6, '0')}`;
    await tx.query('UPDATE clientes SET codigo_cliente=$1 WHERE id=$2', [codigo, id]);
    clientes.set(codigo.toLowerCase(), id);
  } else clientes.set(clave.toLowerCase(), id);
  clientesPorHuella.set(claveHuella, id);
  r.created++;
}

async function importarContenedor({ tx, v, fila, falla, r, contenedores, actualizar, clave }) {
  const salida = fechaIso(v.departure), eta = fechaIso(v.eta), llegada = fechaIso(v.arrival);
  if (salida === null || eta === null || llegada === null) return falla(fila, 'Una de las fechas no es válida (usa AAAA-MM-DD o DD/MM/AAAA)');
  const estado = v.status ? ESTADOS_ENVIO[norm(v.status)] : null;
  if (v.status && !estado) return falla(fila, `Estado «${v.status}» no reconocido (Preparando, En tránsito, En Venezuela, Entregado o Cerrado)`);
  const existente = contenedores.get(clave.toLowerCase());
  if (existente) {
    if (!actualizar) { r.skipped++; return; }
    await tx.query('UPDATE contenedores SET origen=COALESCE($1,origen),fecha_salida=COALESCE($2,fecha_salida),fecha_estimada=COALESCE($3,fecha_estimada),fecha_llegada=COALESCE($4,fecha_llegada),estado=COALESCE($5,estado),observaciones=COALESCE($6,observaciones) WHERE id=$7',
      [v.origin || null, salida || null, eta || null, llegada || null, estado, v.notes || null, existente]);
    r.updated++;
    return;
  }
  const ins = await tx.query('INSERT INTO contenedores(numero,origen,fecha_salida,fecha_estimada,fecha_llegada,estado,observaciones) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id', [clave.slice(0, 100), v.origin || null, salida || null, eta || null, llegada || null, estado || 'prep', v.notes || null]);
  contenedores.set(clave.toLowerCase(), ins.rows[0].id);
  r.created++;
}

async function importarEtiqueta({ tx, v, fila, falla, r, clientes, contenedores, etiquetas, actualizar, clave }) {
  const clienteId = v.clientCode ? clientes.get(String(v.clientCode).toLowerCase()) : null;
  if (!clienteId) return falla(fila, `No existe el cliente «${v.clientCode || ''}»; impórtalo primero`);
  let contenedorId = null;
  if (v.container) {
    contenedorId = contenedores.get(String(v.container).toLowerCase());
    if (!contenedorId) return falla(fila, `No existe el contenedor «${v.container}»; impórtalo primero`);
  }
  const cajasP = numero(v.boxesPacking), cajasC = numero(v.boxesChina), cbmP = numero(v.cbmPacking), cbmC = numero(v.cbmChina);
  if ([cajasP, cajasC, cbmP, cbmC].some((x) => Number.isNaN(x) || (x != null && x < 0))) return falla(fila, 'Cajas o CBM con un valor que no es un número válido');
  const estado = v.status ? ESTADOS_ENVIO[norm(v.status)] : null;
  if (v.status && !estado) return falla(fila, `Estado «${v.status}» no reconocido (Preparando, En tránsito, En Venezuela, Facturado o Cerrado)`);
  const existente = etiquetas.get(clave.toLowerCase());
  const valores = [clienteId, contenedorId, estado, v.notes || null, v.cargoType || null, cajasP == null ? null : Math.trunc(cajasP), cajasC == null ? null : Math.trunc(cajasC), cbmP, cbmC];
  if (existente) {
    if (!actualizar) { r.skipped++; return; }
    await tx.query('UPDATE etiquetas SET cliente_id=$1,contenedor_id=COALESCE($2,contenedor_id),estado=COALESCE($3,estado),observaciones=COALESCE($4,observaciones),tipo_mercancia=COALESCE($5,tipo_mercancia),cajas_packing_list=COALESCE($6,cajas_packing_list),cajas_en_china=COALESCE($7,cajas_en_china),cbm_packing_list=COALESCE($8,cbm_packing_list),cbm_real_china=COALESCE($9,cbm_real_china),fecha_actualizacion=CURRENT_TIMESTAMP WHERE id=$10', [...valores, existente]);
    r.updated++;
    return;
  }
  const ins = await tx.query('INSERT INTO etiquetas(numero,cliente_id,contenedor_id,estado,observaciones,tipo_mercancia,cajas_packing_list,cajas_en_china,cbm_packing_list,cbm_real_china) VALUES($1,$2,$3,COALESCE($4,\'prep\'),$5,$6,$7,$8,$9,$10) RETURNING id',
    [clave.slice(0, 100), clienteId, contenedorId, estado, v.notes || null, v.cargoType || null, valores[5], valores[6], cbmP, cbmC]);
  etiquetas.set(clave.toLowerCase(), ins.rows[0].id);
  r.created++;
}

module.exports = { registrar, TIPOS, sugerirMapeo, fechaIso, numero };
