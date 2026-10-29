/**
 * Copia los datos de Criollo Cargo (SQLite local o Postgres local) a Supabase, conservando los id.
 *
 *   node scripts/migrar-a-supabase.js                 simulacro: carga todo, muestra el resumen y DESHACE
 *   node scripts/migrar-a-supabase.js --aplicar       carga de verdad
 *   node scripts/migrar-a-supabase.js --json dump.json   origen = volcado JSON { tabla: [filas] } en vez de la base local
 *
 * Variables: DATABASE_URL_DESTINO (cadena de conexión de Supabase) y, para el origen local, las PG* de siempre o nada (SQLite).
 * DATABASE_URL debe estar SIN definir mientras se migra: es la que usa el servidor y haría que el origen fuese Supabase.
 * Requiere que supabase/migrations/*.sql ya esté aplicado en el destino. No pisa datos: aborta si el destino no está vacío.
 * Todo ocurre en una transacción; las referencias a filas que ya no existen (huérfanas) se anulan o se omiten y se informan.
 */
const fs = require('fs');
const path = require('path');

// Orden de carga (padres antes que hijos) y las llaves foráneas de cada tabla:
//   col → [tabla padre, qué hacer si el padre no existe: 'null' deja la columna vacía, 'omitir' descarta la fila]
const TABLAS = [
  { t: 'usuarios', fk: {} },
  { t: 'clientes', fk: { asesora_id: ['usuarios', 'null'] } },
  { t: 'contenedores', fk: {} },
  { t: 'etiquetas', fk: { cliente_id: ['clientes', 'null'], contenedor_id: ['contenedores', 'null'], etiqueta_padre_id: ['etiquetas', 'null'] }, padres: 'etiqueta_padre_id' },
  { t: 'historial', fk: { usuario_id: ['usuarios', 'null'] } },
  { t: 'recordatorios', fk: { cliente_id: ['clientes', 'null'], asesora_id: ['usuarios', 'null'], creado_por: ['usuarios', 'null'] } },
  { t: 'quejas', fk: { usuario_id: ['usuarios', 'null'] } },
  { t: 'queja_archivos', fk: { queja_id: ['quejas', 'omitir'] } },
  { t: 'notas_equipo', fk: { usuario_id: ['usuarios', 'null'] } },
  { t: 'etiqueta_lotes', fk: { etiqueta_id: ['etiquetas', 'omitir'] } },
  { t: 'etiqueta_fotos', fk: { etiqueta_id: ['etiquetas', 'omitir'] } },
  { t: 'cliente_preferencias', fk: { cliente_id: ['clientes', 'omitir'] }, pk: 'cliente_id' },
  { t: 'cliente_dispositivos', fk: { cliente_id: ['clientes', 'omitir'] } },
  { t: 'cliente_avisos', fk: { cliente_id: ['clientes', 'omitir'], etiqueta_id: ['etiquetas', 'null'] } },
];

const esVacio = (v) => v === undefined || v === null;

/** Los padres de una auto-referencia deben insertarse antes que sus hijos. */
function ordenarPorPadre(filas, col) {
  const ids = new Set(filas.map((f) => f.id));
  const hechos = new Set();
  const salida = [];
  let pendientes = [...filas];
  while (pendientes.length) {
    const antes = pendientes.length;
    pendientes = pendientes.filter((f) => {
      if (esVacio(f[col]) || !ids.has(f[col]) || hechos.has(f[col])) { salida.push(f); hechos.add(f.id); return false; }
      return true;
    });
    if (pendientes.length === antes) { pendientes.forEach((f) => { f[col] = null; salida.push(f); }); break; } // ciclo: se corta
  }
  return salida;
}

/**
 * @param destino  { query(sql, params) → Promise<{ rows }> } (un Client de pg, o PGlite en las pruebas)
 * @param datos    { tabla: [filas] }
 * @returns resumen por tabla
 */
async function migrar(destino, datos, { aplicar = false, log = () => {} } = {}) {
  for (const t of ['usuarios', 'clientes', 'etiquetas']) {
    const r = await destino.query(`select count(*)::int as n from ${t}`);
    if (r.rows[0].n > 0) throw new Error(`El destino ya tiene datos en ${t}; no se mezcla. Usa un proyecto de Supabase vacío.`);
  }

  const resumen = {};
  const ids = {}; // tabla → Set de id cargados
  await destino.query('begin');
  try {
    for (const def of TABLAS) {
      const cols = (await destino.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name=$1", [def.t])).rows;
      if (!cols.length) throw new Error(`Falta la tabla ${def.t} en el destino: aplica primero supabase/migrations.`);
      const tipo = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));
      let filas = (datos[def.t] || []).map((f) => ({ ...f }));
      const r = (resumen[def.t] = { origen: filas.length, cargadas: 0, anuladas: 0, omitidas: 0 });
      ids[def.t] = ids[def.t] || new Set();

      // Referencias a filas que no existen
      const propios = new Set(filas.map((f) => f.id));
      filas = filas.filter((f) => {
        for (const [col, [padre, modo]] of Object.entries(def.fk)) {
          if (esVacio(f[col])) continue;
          const existe = padre === def.t ? propios.has(f[col]) : ids[padre]?.has(f[col]); // la auto-referencia busca en la misma tabla
          if (existe) continue;
          if (modo === 'omitir') { r.omitidas++; return false; }
          f[col] = null; r.anuladas++;
        }
        return true;
      });
      if (def.padres) filas = ordenarPorPadre(filas, def.padres);

      for (const f of filas) {
        const nombres = Object.keys(f).filter((c) => tipo[c] && !esVacio(f[c]));
        if (!nombres.length) continue;
        const valores = nombres.map((c) => (tipo[c] === 'boolean' ? !!(f[c] === 1 || f[c] === '1' || f[c] === true || f[c] === 't') : f[c]));
        await destino.query(`insert into ${def.t} (${nombres.join(',')}) values (${nombres.map((_, i) => `$${i + 1}`).join(',')})`, valores);
        ids[def.t].add(f[def.pk || 'id']);
        r.cargadas++;
      }
      // Que los próximos INSERT del servidor no choquen con los id copiados.
      if (!def.pk) await destino.query(`select setval(pg_get_serial_sequence('${def.t}','id'), greatest((select coalesce(max(id),0) from ${def.t}), 1), (select count(*) > 0 from ${def.t}))`);
      log(`${def.t}: ${r.cargadas}/${r.origen}${r.anuladas ? `, ${r.anuladas} referencia(s) huérfana(s) anulada(s)` : ''}${r.omitidas ? `, ${r.omitidas} fila(s) huérfana(s) omitida(s)` : ''}`);
    }
    await destino.query(aplicar ? 'commit' : 'rollback');
  } catch (e) {
    await destino.query('rollback').catch(() => {});
    throw e;
  }
  return resumen;
}

/* ---------- línea de comandos ---------- */

async function leerOrigenLocal() {
  const db = require('../db');
  await db.initCheck();
  const datos = {};
  for (const { t, pk } of TABLAS) {
    try {
      datos[t] = (await db.query(`select * from ${t} order by ${pk || 'id'}`)).rows;
    } catch (e) {
      if (!/no such table|does not exist/i.test(e.message)) throw e;
      datos[t] = []; // tabla que esa base aún no tiene (por ejemplo, las de la app móvil)
    }
  }
  return datos;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const iJson = args.indexOf('--json');
  const url = process.env.DATABASE_URL_DESTINO;
  if (!url) throw new Error('Define DATABASE_URL_DESTINO con la cadena de conexión de Supabase.');
  if (iJson < 0 && process.env.DATABASE_URL) throw new Error('Quita DATABASE_URL mientras migras: el origen sería Supabase en vez de la base local.');

  const datos = iJson >= 0 ? JSON.parse(fs.readFileSync(path.resolve(args[iJson + 1]), 'utf8')) : await leerOrigenLocal();
  const { Client } = require('pg');
  const { opcionesSsl } = require('../db');
  const cliente = new Client({ connectionString: url, ssl: opcionesSsl() });
  await cliente.connect();
  try {
    console.log(aplicar ? 'Migrando (se aplicará)…' : 'Simulacro: se carga todo y al final se deshace.');
    const resumen = await migrar(cliente, datos, { aplicar, log: console.log });
    const total = Object.values(resumen).reduce((s, r) => s + r.cargadas, 0);
    console.log(aplicar ? `\nListo: ${total} filas copiadas.` : `\nSimulacro correcto: ${total} filas se copiarían. Corre de nuevo con --aplicar.`);
  } finally {
    await cliente.end();
  }
}

module.exports = { migrar, TABLAS };

if (require.main === module) {
  main().catch((e) => { console.error('❌', e.message); process.exit(1); });
}
