/**
 * Lector de packing list con IA: recibe la foto (JPG, PNG o WEBP) o el Excel/CSV del packing list del proveedor,
 * se lo pasa a un modelo de IA y devuelve los datos ordenados para autocompletar la etiqueta.
 *
 *   POST /api/packing-list/leer   multipart con `archivo` → { datos, sugerido, avisos }   (no guarda nada)
 *
 * Funciona con cualquier proveedor que hable la API de OpenAI (chat/completions): OpenAI, Gemini, Ollama, DeepSeek…
 *   IA_PROVEEDOR = openai | gemini | ollama | deepseek   (fija la URL y el modelo por defecto)
 *   IA_API_KEY   = clave del proveedor (Ollama local no la necesita)
 *   IA_MODELO    = modelo a usar (opcional; debe aceptar imágenes para leer fotos)
 *   IA_BASE_URL  = URL base compatible con OpenAI (opcional; para otro proveedor o un Ollama en otra máquina)
 *   IA_ESPERA_SEGUNDOS = cuánto esperar la respuesta (90 s; 300 s con Ollama)
 * DeepSeek no acepta imágenes por su API: con él solo se leen packing lists en Excel o CSV.
 */
const multer = require('multer');
const XLSX = require('xlsx');

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXTO = 60000; // caracteres de la hoja que se le pasan al modelo

const PROVEEDORES = {
  openai: { url: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini', imagenes: true },
  gemini: { url: 'https://generativelanguage.googleapis.com/v1beta/openai', modelo: 'gemini-flash-latest', imagenes: true },
  ollama: { url: 'http://localhost:11434/v1', modelo: 'qwen2.5vl', imagenes: true, espera: 300 }, // en CPU una foto tarda minutos
  deepseek: { url: 'https://api.deepseek.com/v1', modelo: 'deepseek-chat', imagenes: false },
};

function configuracion() {
  const nombre = String(process.env.IA_PROVEEDOR || '').trim().toLowerCase();
  const base = PROVEEDORES[nombre] || {};
  const url = String(process.env.IA_BASE_URL || base.url || '').trim().replace(/\/+$/, '');
  const modelo = String(process.env.IA_MODELO || base.modelo || '').trim();
  const espera = Number(process.env.IA_ESPERA_SEGUNDOS) || base.espera || 90;
  return { nombre: nombre || 'personalizado', url, modelo, clave: String(process.env.IA_API_KEY || '').trim(), imagenes: base.imagenes !== false, esperaMs: espera * 1000 };
}

const INSTRUCCIONES = `Eres un asistente de una empresa de carga China → Venezuela. Lees PACKING LISTS de proveedores chinos (pueden venir en inglés, chino o español, con columnas en cualquier orden, celdas combinadas y totales resaltados) y devuelves SOLO un objeto JSON, sin texto adicional, con esta forma exacta:
{
  "esPackingList": true,
  "proveedor": "nombre de la empresa que vende/envía",
  "comprador": "nombre del cliente que compra/recibe",
  "rifComprador": "RIF o ID del comprador tal como aparece (ej. J-412905147)",
  "numeroDocumento": "número de packing list o factura",
  "fecha": "YYYY-MM-DD",
  "origen": "ciudad de origen",
  "destino": "ciudad de destino",
  "mercancia": "descripción corta EN ESPAÑOL del tipo de mercancía (ej. 'Cable THHN', 'Guantes de nitrilo', 'Faros LED para moto')",
  "lineas": [
    { "descripcion": "producto", "sku": "código o modelo", "codigoHs": "código arancelario", "cantidad": 0, "unidad": "PCS",
      "cajas": 0, "largoCm": 0, "anchoCm": 0, "altoCm": 0, "pesoBrutoKg": 0, "pesoNetoKg": 0, "cbm": 0 }
  ],
  "totales": { "cajas": 0, "cantidad": 0, "pesoBrutoKg": 0, "pesoNetoKg": 0, "cbm": 0 },
  "notas": "cualquier cosa rara o ilegible"
}
Reglas:
- Usa números JSON (punto decimal). Convierte comas decimales: "33,8" → 33.8. Si un dato no aparece, usa null; nunca lo inventes.
- "cajas" = cartones/bultos (CTNS, Package ctn, 件数). "cantidad" = unidades del producto (PCS, boxes, 数量).
- En cada línea, pesoBrutoKg, pesoNetoKg y cbm son el TOTAL de esa línea (no por caja). Si el documento solo da el valor por caja, multiplícalo por las cajas.
- largoCm/anchoCm/altoCm son las medidas de UNA caja (ej. "49cm*36.5cm*41cm" o "61*25*27cm"). Si hay una sola medida para todo el envío, ponla en cada línea.
- Si varios productos comparten la misma caja (celdas combinadas), pon las cajas solo en la primera línea de ese grupo y 0 en las demás.
- "totales" es la fila TOTAL tal como está impresa en el documento; null en los que no estén impresos. No la incluyas como línea.
- Ignora direcciones, teléfonos y sellos salvo para proveedor y comprador.
- Si el documento no es un packing list, devuelve "esPackingList": false y lo que puedas.`;

/* ---------- utilidades ---------- */

/** Número desde lo que mande el modelo: 33.8, "33,8", "1.200", "375.00 kg"… */
function numero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : null;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const texto = (v, max = 200) => (v == null ? '' : String(v).trim().slice(0, max));
const redondear = (n, d = 3) => (n == null ? null : Math.round((n + Number.EPSILON) * 10 ** d) / 10 ** d);
const suma = (lista, k) => (lista.some((l) => l[k] != null) ? lista.reduce((s, l) => s + (l[k] || 0), 0) : null);
const fechaIso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(texto(v, 10)) ? texto(v, 10) : null);

/** El modelo a veces envuelve el JSON en ```json … ``` o le agrega una frase: se toma el primer objeto completo. */
function extraerJson(contenido) {
  const s = String(contenido || '');
  const ini = s.indexOf('{'), fin = s.lastIndexOf('}');
  if (ini < 0 || fin <= ini) throw new Error('La IA no devolvió datos legibles. Intenta con una imagen más nítida.');
  return JSON.parse(s.slice(ini, fin + 1));
}

function tipoDeImagen(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Excel o CSV → texto CSV por hoja (así también sirve con modelos que no leen imágenes). */
function hojaComoTexto(buffer, nombre) {
  const esCsv = /\.csv$/i.test(nombre || '');
  const wb = esCsv ? XLSX.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true }) : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((n) => `### Hoja: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n').slice(0, MAX_TEXTO);
}

/* ---------- llamada al modelo ---------- */

async function preguntarIA(cfg, contenidoUsuario) {
  const cuerpo = { model: cfg.modelo, temperature: 0, messages: [{ role: 'system', content: INSTRUCCIONES }, { role: 'user', content: contenidoUsuario }], response_format: { type: 'json_object' } };
  const pedir = async (body) => {
    const r = await fetch(`${cfg.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.clave ? { Authorization: `Bearer ${cfg.clave}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.esperaMs),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  };
  let r = await pedir(cuerpo);
  // Algunos modelos o servidores no aceptan response_format: se reintenta sin él (el prompt ya pide solo JSON).
  if (!r.ok && r.status === 400) { delete cuerpo.response_format; r = await pedir(cuerpo); }
  if (!r.ok) {
    const detalle = texto(r.j?.error?.message || r.j?.error || r.j?.message, 300);
    const err = new Error(`El proveedor de IA respondió ${r.status}${detalle ? `: ${detalle}` : ''}`);
    err.status = r.status === 401 || r.status === 403 ? 503 : 502;
    throw err;
  }
  const contenido = r.j?.choices?.[0]?.message?.content;
  return extraerJson(Array.isArray(contenido) ? contenido.map((c) => c?.text || '').join('') : contenido);
}

/* ---------- limpieza y validación ---------- */

function normalizar(bruto) {
  const lineas = (Array.isArray(bruto?.lineas) ? bruto.lineas : []).slice(0, 100).map((l) => ({
    descripcion: texto(l?.descripcion, 120), sku: texto(l?.sku, 60), codigoHs: texto(l?.codigoHs, 20),
    cantidad: numero(l?.cantidad), unidad: texto(l?.unidad, 20), cajas: numero(l?.cajas),
    largoCm: numero(l?.largoCm), anchoCm: numero(l?.anchoCm), altoCm: numero(l?.altoCm),
    pesoBrutoKg: numero(l?.pesoBrutoKg), pesoNetoKg: numero(l?.pesoNetoKg), cbm: numero(l?.cbm),
  })).filter((l) => l.descripcion || l.sku || l.cajas || l.cantidad);
  const t = bruto?.totales || {};
  return {
    esPackingList: bruto?.esPackingList !== false,
    proveedor: texto(bruto?.proveedor), comprador: texto(bruto?.comprador), rifComprador: texto(bruto?.rifComprador, 30),
    numeroDocumento: texto(bruto?.numeroDocumento, 60), fecha: fechaIso(bruto?.fecha),
    origen: texto(bruto?.origen, 80), destino: texto(bruto?.destino, 80), mercancia: texto(bruto?.mercancia, 120),
    lineas,
    totales: { cajas: numero(t.cajas), cantidad: numero(t.cantidad), pesoBrutoKg: numero(t.pesoBrutoKg), pesoNetoKg: numero(t.pesoNetoKg), cbm: numero(t.cbm) },
    notas: texto(bruto?.notas, 500),
  };
}

/** Cruza las líneas con los totales impresos y con las medidas de las cajas para avisar de errores del documento o de la lectura. */
function revisar(d) {
  const avisos = [];
  if (!d.esPackingList) avisos.push('El archivo no parece un packing list. Revisa que subiste el documento correcto.');
  if (!d.lineas.length) avisos.push('No se encontraron líneas de producto.');
  const sumas = { cajas: suma(d.lineas, 'cajas'), pesoBrutoKg: suma(d.lineas, 'pesoBrutoKg'), pesoNetoKg: suma(d.lineas, 'pesoNetoKg'), cbm: suma(d.lineas, 'cbm') };
  const nombres = { cajas: 'cajas', pesoBrutoKg: 'peso bruto', pesoNetoKg: 'peso neto', cbm: 'CBM' };
  for (const k of Object.keys(sumas)) {
    const impreso = d.totales[k], calculado = sumas[k];
    if (impreso == null || calculado == null) continue;
    const tolerancia = k === 'cajas' ? 0.5 : Math.max(0.02 * impreso, k === 'cbm' ? 0.01 : 0.5);
    if (Math.abs(impreso - calculado) > tolerancia) avisos.push(`El total de ${nombres[k]} impreso (${redondear(impreso)}) no coincide con la suma de las líneas (${redondear(calculado)}).`);
  }
  d.lineas.forEach((l, i) => {
    const nombre = l.descripcion || l.sku || `línea ${i + 1}`;
    if (l.cajas != null && !Number.isInteger(l.cajas)) avisos.push(`«${nombre}» tiene ${l.cajas} cajas (fracción): probablemente comparte cajas con otro producto.`);
    if (l.cajas > 0 && l.largoCm && l.anchoCm && l.altoCm && l.cbm) {
      const porMedidas = (l.largoCm * l.anchoCm * l.altoCm / 1e6) * l.cajas;
      if (Math.abs(porMedidas - l.cbm) > Math.max(0.15 * l.cbm, 0.01)) avisos.push(`«${nombre}»: el CBM indicado (${redondear(l.cbm)}) no cuadra con las medidas de la caja (${redondear(porMedidas)} m³ por ${l.cajas} caja(s)).`);
    }
  });
  if (d.notas) avisos.push(`Nota de la IA: ${d.notas}`);
  const cajas = d.totales.cajas ?? sumas.cajas;
  const cbm = d.totales.cbm ?? sumas.cbm;
  // Lotes de la app del cliente: una línea con cajas propias = un lote. Las cajas compartidas (6.5 + 6.5) se redondean
  // sobre el acumulado para que la suma de lotes siga dando el total del documento (13, no 7 + 7 = 14).
  let acumulado = 0;
  const lotes = [];
  for (const l of d.lineas.filter((x) => x.cajas > 0)) {
    const antes = Math.round(acumulado);
    acumulado += l.cajas;
    const enteras = Math.round(acumulado) - antes;
    if (enteras < 1) continue;
    lotes.push({
      nombre: [l.descripcion, l.sku].filter(Boolean).join(' · ').slice(0, 80) || 'Lote',
      cajas: enteras,
      kgPorCaja: l.pesoBrutoKg != null ? redondear(l.pesoBrutoKg / enteras, 2) : null, // así el peso total del lote no cambia
      largoCm: l.largoCm, anchoCm: l.anchoCm, altoCm: l.altoCm,
    });
  }
  return {
    sugerido: {
      cajas: cajas == null ? null : Math.round(cajas),
      cbm: redondear(cbm),
      mercancia: d.mercancia,
      pesoBrutoKg: redondear(d.totales.pesoBrutoKg ?? sumas.pesoBrutoKg, 2),
      lotes,
    },
    avisos,
  };
}

/* ---------- ruta ---------- */

function registrar(app, { auth, logAction }) {
  const subir = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: MAX_BYTES } });

  app.get('/api/packing-list/estado', auth, (req, res) => {
    const cfg = configuracion();
    res.json({ activo: Boolean(cfg.url && cfg.modelo), proveedor: cfg.nombre, modelo: cfg.modelo, imagenes: cfg.imagenes });
  });

  // multer se llama a mano para responder en JSON si el archivo pasa de 10 MB (el servidor no tiene manejador de errores).
  const recibir = (req, res, next) => subir.single('archivo')(req, res, (err) => (err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pasa de 10 MB.' : 'No se pudo recibir el archivo.' }) : next()));

  app.post('/api/packing-list/leer', auth, recibir, async (req, res) => {
    const cfg = configuracion();
    if (!cfg.url || !cfg.modelo) return res.status(503).json({ error: 'El lector con IA no está configurado: define IA_PROVEEDOR e IA_API_KEY en el .env del servidor.' });
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Adjunta el packing list (foto o Excel).' });
    try {
      let contenido;
      const mime = tipoDeImagen(f.buffer); // se confía en los bytes, no en el nombre ni en el tipo declarado
      if (mime) {
        if (!cfg.imagenes) return res.status(400).json({ error: `El proveedor ${cfg.nombre} no lee imágenes. Sube el packing list en Excel o CSV, o usa OpenAI, Gemini u Ollama.` });
        contenido = [
          { type: 'text', text: 'Extrae los datos de este packing list.' },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${f.buffer.toString('base64')}` } },
        ];
      } else if (/\.(xlsx|xls|csv)$/i.test(f.originalname || '')) {
        contenido = `Extrae los datos de este packing list (exportado de Excel a CSV):\n\n${hojaComoTexto(f.buffer, f.originalname)}`;
      } else {
        return res.status(400).json({ error: 'Formato no admitido. Sube una foto (JPG, PNG o WEBP) o un Excel/CSV. Si es PDF, toma una captura de pantalla.' });
      }
      const datos = normalizar(await preguntarIA(cfg, contenido));
      const { sugerido, avisos } = revisar(datos);
      await logAction(req.user.id, 'Packing list leído con IA', 'etiquetas', null, `${datos.proveedor || 'Proveedor sin nombre'} · ${sugerido.cajas ?? '?'} cajas · ${sugerido.cbm ?? '?'} CBM (${cfg.nombre}/${cfg.modelo}).`);
      res.json({ datos, sugerido, avisos });
    } catch (e) {
      console.error('Lector de packing list:', e.message);
      const tiempo = e.name === 'TimeoutError' || e.name === 'AbortError';
      res.status(e.status || (tiempo ? 504 : 502)).json({ error: tiempo ? 'La IA tardó demasiado en responder. Intenta de nuevo.' : e.message || 'No se pudo leer el packing list' });
    }
  });
}

module.exports = { registrar, normalizar, revisar, numero };
