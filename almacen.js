/**
 * Almacén de las fotos de las etiquetas.
 *   - 'supabase': bucket privado de Supabase Storage (con SUPABASE_URL y SUPABASE_SECRET_KEY). Es lo que se usa en producción.
 *   - 'disco'   : uploads/etiquetas/ (solo desarrollo, o fotos viejas anteriores al cambio).
 * Cada fila de etiqueta_fotos recuerda en qué almacén quedó su archivo, así conviven las dos sin migrar de golpe.
 * La clave secreta solo vive en el servidor; la app móvil nunca habla con Storage: pide la foto al servidor con su sesión.
 */
const fs = require('fs');
const path = require('path');

const DISCO = path.join(__dirname, 'uploads', 'etiquetas');
const BUCKET = process.env.SUPABASE_BUCKET_FOTOS || 'etiquetas-fotos';
const TIMEOUT_MS = 15000;

const base = () => String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const clave = () => process.env.SUPABASE_SECRET_KEY || '';
const hayStorage = () => Boolean(base() && clave());

/** Almacén en el que se guardan las fotos nuevas. */
const almacenActual = () => (hayStorage() ? 'supabase' : 'disco');

const cabeceras = (extra = {}) => ({ apikey: clave(), ...extra });
// La clave de objeto lleva carpeta ("e12/archivo.jpg"): se codifica cada tramo, no las barras.
const rutaObjeto = (clv) => clv.split('/').map(encodeURIComponent).join('/');

async function pedir(ruta, init = {}) {
  const r = await fetch(`${base()}/storage/v1${ruta}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return r;
}

async function errorDe(r, accion) {
  const t = await r.text().catch(() => '');
  return new Error(`Storage: ${accion} falló (HTTP ${r.status}) ${t.slice(0, 160)}`);
}

/** Crea el bucket privado si no existe (las migraciones SQL también lo crean; esto cubre un proyecto sin migrar). */
async function asegurarBucket() {
  if (!hayStorage()) return;
  const r = await pedir('/bucket', {
    method: 'POST',
    headers: cabeceras({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (r.ok) return;
  const t = await r.text().catch(() => '');
  if (r.status === 409 || /already exists|Duplicate/i.test(t)) return;
  throw new Error(`Storage: no se pudo crear el bucket ${BUCKET} (HTTP ${r.status}) ${t.slice(0, 160)}`);
}

/** Guarda el archivo y devuelve { almacen, clave } para anotar en la base. */
async function guardar(clv, buffer, mime) {
  if (almacenActual() === 'supabase') {
    const r = await pedir(`/object/${BUCKET}/${rutaObjeto(clv)}`, {
      method: 'POST',
      headers: cabeceras({ 'Content-Type': mime, 'x-upsert': 'false' }),
      body: buffer,
    });
    if (!r.ok) throw await errorDe(r, 'subir la foto');
    return { almacen: 'supabase', clave: clv };
  }
  const plano = clv.replace(/\//g, '_');
  fs.mkdirSync(DISCO, { recursive: true });
  fs.writeFileSync(path.join(DISCO, plano), buffer);
  return { almacen: 'disco', clave: plano };
}

/** Devuelve el contenido, o null si el archivo no existe. */
async function leer(almacen, clv) {
  if (almacen === 'supabase') {
    if (!hayStorage()) throw new Error('Storage no está configurado en este servidor');
    const r = await pedir(`/object/authenticated/${BUCKET}/${rutaObjeto(clv)}`, { headers: cabeceras() });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw await errorDe(r, 'descargar la foto');
    return Buffer.from(await r.arrayBuffer());
  }
  const archivo = path.join(DISCO, path.basename(clv));
  return fs.existsSync(archivo) ? fs.readFileSync(archivo) : null;
}

/** Borra archivos [{ almacen, nombre_guardado }]. Nunca lanza: un archivo huérfano no debe tumbar el borrado de la fila. */
async function borrar(archivos) {
  const enStorage = archivos.filter((a) => a.almacen === 'supabase').map((a) => a.nombre_guardado);
  for (const a of archivos.filter((x) => x.almacen !== 'supabase')) {
    try { fs.rmSync(path.join(DISCO, path.basename(a.nombre_guardado)), { force: true }); } catch (e) { console.error('No se pudo borrar la foto local:', e.message); }
  }
  if (!enStorage.length || !hayStorage()) return;
  try {
    const r = await pedir(`/object/${BUCKET}`, { method: 'DELETE', headers: cabeceras({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: enStorage }) });
    if (!r.ok) console.error((await errorDe(r, 'borrar fotos')).message);
  } catch (e) {
    console.error('No se pudieron borrar las fotos de Storage:', e.message);
  }
}

module.exports = { hayStorage, almacenActual, asegurarBucket, guardar, leer, borrar, BUCKET };
