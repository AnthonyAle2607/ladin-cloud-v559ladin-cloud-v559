/**
 * Sube a Supabase Storage las fotos que siguen en el disco del servidor (almacen = 'disco') y las marca como 'supabase'.
 *
 *   node scripts/subir-fotos-a-storage.js              simulacro: dice qué subiría
 *   node scripts/subir-fotos-a-storage.js --aplicar    sube y actualiza la base
 *   node scripts/subir-fotos-a-storage.js --aplicar --borrar-local   además borra el archivo local ya subido
 *
 * Usa la misma base y el mismo .env que el servidor (DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY).
 * Si falta el archivo local de una foto, la deja como está y lo informa. Se puede repetir sin duplicar.
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');
const almacen = require('../almacen');

const DISCO = path.join(__dirname, '..', 'uploads', 'etiquetas');

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const borrarLocal = args.includes('--borrar-local');
  if (!almacen.hayStorage()) throw new Error('Define SUPABASE_URL y SUPABASE_SECRET_KEY.');

  await db.initCheck();
  const fotos = (await db.query("SELECT id,etiqueta_id,nombre_guardado,mime_type FROM etiqueta_fotos WHERE almacen='disco' ORDER BY id")).rows;
  console.log(`${fotos.length} foto(s) en disco.`);
  if (aplicar) await almacen.asegurarBucket();

  let subidas = 0, faltan = 0;
  for (const f of fotos) {
    const archivo = path.join(DISCO, path.basename(f.nombre_guardado));
    if (!fs.existsSync(archivo)) { console.log(`  ✗ #${f.id}: no está el archivo ${f.nombre_guardado}`); faltan++; continue; }
    if (!aplicar) { console.log(`  · #${f.id} ${f.nombre_guardado} → se subiría`); continue; }
    const clave = `e${f.etiqueta_id}/${path.basename(f.nombre_guardado)}`;
    const r = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${almacen.BUCKET}/${clave.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { apikey: process.env.SUPABASE_SECRET_KEY, 'Content-Type': f.mime_type, 'x-upsert': 'true' }, // repetir el script no falla
      body: fs.readFileSync(archivo),
    });
    if (!r.ok) throw new Error(`#${f.id}: Storage respondió ${r.status} ${(await r.text()).slice(0, 120)}`);
    await db.query("UPDATE etiqueta_fotos SET almacen='supabase', nombre_guardado=$1 WHERE id=$2", [clave, f.id]);
    if (borrarLocal) fs.rmSync(archivo, { force: true });
    console.log(`  ✓ #${f.id} → ${clave}`);
    subidas++;
  }
  console.log(aplicar ? `\nListo: ${subidas} subida(s), ${faltan} sin archivo local.` : `\nSimulacro: ${fotos.length - faltan} se subirían, ${faltan} sin archivo local. Corre de nuevo con --aplicar.`);
}

main().then(() => process.exit(0), (e) => { console.error('❌', e.message); process.exit(1); });
