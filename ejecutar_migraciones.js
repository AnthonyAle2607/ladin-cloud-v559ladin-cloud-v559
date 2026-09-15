/**
 * LADIN CLOUD - Script de Migración y Exportación Lecturable de ladin_cloud.db
 */
const db = require('./db');
const fs = require('fs');
const path = require('path');

async function runMigrationAndExport() {
  console.log('====================================================');
  console.log('🚀 INICIANDO MIGRACIÓN Y LECTURA DE LADIN_CLOUD.DB');
  console.log('====================================================');

  await db.initCheck();

  // 1. Ejecutar archivos de migración SQL si existen
  const sqlFiles = [
    'MIGRACION_CODIGO_Y_REASIGNACION.sql',
    'MIGRACION_ESTADO_QUEJAS_HISTORIAL.sql',
    'MIGRACION_FAMILIAS_ETIQUETAS.sql'
  ];

  for (const sqlFile of sqlFiles) {
    const filePath = path.join(__dirname, sqlFile);
    if (fs.existsSync(filePath)) {
      console.log(`📌 Ejecutando script de migración: ${sqlFile}...`);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const stmt of statements) {
        try {
          await db.query(stmt);
        } catch (e) {
          // Ignorar errores de columnas/índices ya existentes
          if (!e.message.includes('duplicate') && !e.message.includes('already exists')) {
            console.log(`   └─ Nota en ${sqlFile}: ${e.message}`);
          }
        }
      }
      console.log(`   ✅ Migración de ${sqlFile} completada.`);
    }
  }

  // 2. Extraer todo el contenido de la base de datos
  const tables = ['usuarios', 'clientes', 'contenedores', 'etiquetas', 'quejas', 'recordatorios', 'notas_equipo', 'historial'];
  const fullDump = {};
  let markdownContent = `# 📦 Contenido Completo de la Base de Datos (ladin_cloud.db)\n\n*Fecha de extracción:* ${new Date().toLocaleString('es-VE')}\n\n`;

  for (const table of tables) {
    try {
      const res = await db.query(`SELECT * FROM ${table} ORDER BY id ASC`);
      fullDump[table] = res.rows;

      markdownContent += `## Tabla: \`${table}\` (${res.rows.length} registros)\n\n`;

      if (res.rows.length === 0) {
        markdownContent += `*Sin registros*\n\n`;
      } else {
        const cols = Object.keys(res.rows[0]);
        markdownContent += `| ${cols.join(' | ')} |\n`;
        markdownContent += `| ${cols.map(() => '---').join(' | ')} |\n`;

        for (const row of res.rows) {
          const vals = cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return '`null`';
            if (typeof v === 'object') return `\`${JSON.stringify(v)}\``;
            return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
          });
          markdownContent += `| ${vals.join(' | ')} |\n`;
        }
        markdownContent += `\n`;
      }
    } catch (err) {
      console.error(`Error leyendo tabla ${table}:`, err.message);
    }
  }

  // 3. Guardar archivos de salida lecturables
  const mdPath = path.join(__dirname, 'DOCUMENTO_LEIBLE_LADIN_CLOUD.md');
  const jsonPath = path.join(__dirname, 'ladin_cloud_dump.json');

  fs.writeFileSync(mdPath, markdownContent, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(fullDump, null, 2), 'utf8');

  console.log('====================================================');
  console.log('✅ MIGRACIÓN Y EXTRACCIÓN COMPLETADAS CON ÉXITO');
  console.log(`📄 Documento legible generado en: ${mdPath}`);
  console.log(`📊 Archivo JSON estructurado en:  ${jsonPath}`);
  console.log('====================================================');
}

runMigrationAndExport().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
