require('dotenv').config({ path: process.env.ENV_FILE || 'data.env' });
require('dotenv').config();

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

let useSQLite = false;
let sqliteDb = null;

const pgPool = new Pool({
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  database: process.env.PGDATABASE || 'Ladin cloud',
  password: process.env.PGPASSWORD || 'Ladin.0314',
  port: Number(process.env.PGPORT || 5432),
  connectionTimeoutMillis: 2000
});

pgPool.on('error', (err) => {
  if (!useSQLite) console.error('PostgreSQL pool error:', err.message);
});

function translateSqlForSqlite(sql, params = []) {
  let newSql = sql;
  let newParams = Array.isArray(params) ? [...params] : [];

  // 1. Remove IF NOT EXISTS from ALTER TABLE ... ADD COLUMN
  newSql = newSql.replace(/ALTER\s+TABLE\s+([a-z0-9_]+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/gi, 'ALTER TABLE $1 ADD COLUMN');

  // 2. LPAD(id::text, 6, '0') -> printf('%06d', id)
  newSql = newSql.replace(/LPAD\(([^,]+)(?:::text)?,\s*(\d+),\s*'0'\)/gi, (m, col, len) => `printf('%0${len}d', ${col})`);

  // 3. BTRIM -> TRIM
  newSql = newSql.replace(/\bBTRIM\b/gi, 'TRIM');

  // 4. TO_CHAR(col, 'YYYY-MM-DD') -> SUBSTR(col, 1, 10)
  newSql = newSql.replace(/TO_CHAR\(([^,]+),\s*'YYYY-MM-DD'\)/gi, (m, col) => `SUBSTR(${col}, 1, 10)`);

  // 5. CURRENT_TIMESTAMP - INTERVAL '7 days' -> datetime('now', '-7 days')
  newSql = newSql.replace(/CURRENT_TIMESTAMP\s*-\s*INTERVAL\s*'(\d+)\s*days'/gi, (m, d) => `datetime('now', '-${d} days')`);

  // 6. SERIAL PRIMARY KEY -> INTEGER PRIMARY KEY AUTOINCREMENT
  newSql = newSql.replace(/SERIAL PRIMARY KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');

  // 7. Strip PostgreSQL type casts (::int, ::text, ::date, ::int[], etc.)
  newSql = newSql.replace(/::[a-z0-9_]+(\[\])?/gi, '');

  // 8. Convert ANY(...) to IN (...)
  newSql = newSql.replace(/=\s*ANY\s*\(([^)]+)\)/gi, (m, inner) => ` IN (${inner})`);

  // 9. Map parameters $1, $2 to ?
  const paramMap = new Map();
  newParams.forEach((p, i) => paramMap.set(i + 1, p));

  const finalParams = [];
  newSql = newSql.replace(/\$(\d+)/g, (m, pNum) => {
    const pVal = paramMap.get(parseInt(pNum, 10));
    if (Array.isArray(pVal)) {
      if (pVal.length === 0) return '(NULL)';
      finalParams.push(...pVal);
      return pVal.map(() => '?').join(',');
    } else {
      finalParams.push(pVal);
      return '?';
    }
  });

  return { sql: newSql, params: finalParams };
}

async function testConnection() {
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Conexión con PostgreSQL establecida exitosamente.');
    return true;
  } catch (err) {
    console.log(`⚠️ PostgreSQL no disponible en puerto ${process.env.PGPORT || 5432} (${err.message}).`);
    console.log('🔄 Activando motor de base de datos local persistente SQLite...');
    useSQLite = true;
    initSqlite();
    return false;
  }
}

function initSqlite() {
  const sqlite3 = require('sqlite3').verbose();
  const dbFile = path.join(__dirname, 'ladin_cloud.db');
  sqliteDb = new sqlite3.Database(dbFile);
  sqliteDb.run('PRAGMA foreign_keys = ON;');
  console.log(`✅ Base de datos local SQLite inicializada en: ${dbFile}`);
}

const db = {
  async query(text, params = []) {
    if (!useSQLite) {
      try {
        return await pgPool.query(text, params);
      } catch (e) {
        if (e.code === 'ECONNREFUSED' || e.code === '57P01') {
          console.log('⚠️ Conexión con PostgreSQL interrumpida. Conmutando a SQLite...');
          useSQLite = true;
          if (!sqliteDb) initSqlite();
          return this.query(text, params);
        }
        throw e;
      }
    }

    return new Promise((resolve, reject) => {
      const translated = translateSqlForSqlite(text, params);
      const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(translated.sql);

      if (isSelect) {
        sqliteDb.all(translated.sql, translated.params, (err, rows) => {
          if (err) return reject(err);
          resolve({ rows: rows || [], rowCount: rows ? rows.length : 0 });
        });
      } else {
        sqliteDb.run(translated.sql, translated.params, function (err) {
          if (err) {
            if (err.message && err.message.includes('duplicate column name')) {
              return resolve({ rows: [], rowCount: 0 });
            }
            return reject(err);
          }
          const hasReturning = /RETURNING/i.test(translated.sql);
          if (hasReturning) {
            const tableMatch = translated.sql.match(/(?:INSERT\s+INTO|UPDATE)\s+([a-z0-9_]+)/i);
            const tableName = tableMatch ? tableMatch[1] : null;
            const lastId = this.lastID;
            if (tableName && lastId) {
              sqliteDb.all(`SELECT * FROM ${tableName} WHERE id = ?`, [lastId], (err2, selectRows) => {
                if (err2 || !selectRows.length) {
                  resolve({ rows: [{ id: lastId }], rowCount: this.changes });
                } else {
                  resolve({ rows: selectRows, rowCount: this.changes });
                }
              });
              return;
            }
          }
          resolve({ rows: this.lastID ? [{ id: this.lastID }] : [], rowCount: this.changes });
        });
      }
    });
  },

  async connect() {
    if (!useSQLite) {
      try {
        const client = await pgPool.connect();
        return client;
      } catch (e) {
        if (e.code === 'ECONNREFUSED') {
          useSQLite = true;
          if (!sqliteDb) initSqlite();
        } else throw e;
      }
    }

    return {
      query: (text, params) => db.query(text, params),
      release: () => {}
    };
  },

  on(event, handler) {
    if (!useSQLite) pgPool.on(event, handler);
  },

  initCheck: testConnection
};

module.exports = db;
