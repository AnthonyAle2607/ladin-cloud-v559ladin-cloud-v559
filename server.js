/**
 * LADIN CLOUD - Servidor Backend Express & API REST
 * Version: v559 Fix4
 */
require('dotenv').config({ path: process.env.ENV_FILE || 'data.env' });
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const archiver = require('archiver');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const PDFDocument = require('pdfkit');
const db = require('./db');

const execFileAsync = promisify(execFile);
const UPLOAD_ROOT = path.join(__dirname, 'uploads', 'quejas');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_LADIN_CLOUD_SECRET';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

/* ==========================================================================
   UTILIDADES & MAREADORES DE DTO (DATOS DE SALIDA)
   ========================================================================== */

function intId(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/^[a-z]+/i, ''));
  return Number.isInteger(n) ? n : null;
}

function pref(prefix, n) {
  return `${prefix}${n}`;
}

function intVal(v) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function numVal(v) {
  const n = Number.parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatDateOnly(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime())
    ? ''
    : `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function userOut(r) {
  return {
    id: pref('u', r.id),
    name: r.nombre,
    email: r.email,
    role: r.rol,
    active: !!r.activo,
    advisorCode: r.codigo_asesora || ''
  };
}

function clientOut(r) {
  return {
    id: pref('c', r.id),
    code: r.codigo_cliente || '',
    name: r.nombre + (r.apellido ? ` ${r.apellido}` : ''),
    phone: r.telefono || '',
    email: r.email || '',
    company: r.empresa || '',
    advisorId: r.asesora_id ? pref('u', r.asesora_id) : '',
    advisorCode: r.codigo_asesora || '',
    status: r.estado,
    state: r.estado_venezuela || '',
    firstContactDate: r.fecha_primer_contacto ? String(r.fecha_primer_contacto).slice(0, 10) : '',
    createdAt: r.fecha_registro?.toISOString?.().slice(0, 10) || String(r.fecha_registro || '').slice(0, 10),
    updatedAt: r.fecha_actualizacion?.toISOString?.().slice(0, 10) || String(r.fecha_actualizacion || r.fecha_registro || '').slice(0, 10),
    notes: r.observaciones || ''
  };
}

function labelOut(r, family = {}) {
  return {
    id: pref('l', r.id),
    number: r.numero,
    clientId: r.cliente_id ? pref('c', r.cliente_id) : '',
    containerId: r.contenedor_id ? pref('co', r.contenedor_id) : '',
    status: r.estado === 'done' ? 'facturado' : (r.estado || 'prep'),
    notes: r.observaciones || '',
    ready: !!r.lista,
    cargoType: r.tipo_mercancia || '',
    boxesPacking: r.cajas_packing_list == null ? '' : Number(r.cajas_packing_list),
    boxesChina: r.cajas_en_china == null ? '' : Number(r.cajas_en_china),
    boxesVenezuela: r.cajas_recibidas_venezuela == null ? '' : Number(r.cajas_recibidas_venezuela),
    cbmPacking: r.cbm_packing_list == null ? '' : Number(r.cbm_packing_list),
    cbmChina: r.cbm_real_china == null ? '' : Number(r.cbm_real_china),
    cbmMissing: Math.max((Number(r.cbm_packing_list) || 0) - (Number(r.cbm_real_china) || 0), 0),
    familyCode: r.familia_codigo || '',
    parentLabelId: r.etiqueta_padre_id ? pref('l', r.etiqueta_padre_id) : '',
    isFamilyParent: !!r.tiene_subetiquetas || (!r.etiqueta_padre_id && Number(family.childCount || 0) > 0),
    subLabelCount: Number(family.childCount || 0),
    familyExpected: Number(family.expected || 0),
    familyBoxesRegistered: Number(family.boxesRegistered || 0),
    familyRemaining: Number(family.remaining || 0),
    familyProgress: Number(family.progress || 0),
    familyComplete: Boolean(family.complete || false),
    arrivalChina: r.fecha_llegada_china ? String(r.fecha_llegada_china).slice(0, 10) : '',
    departureChina: r.fecha_salida_china ? String(r.fecha_salida_china).slice(0, 10) : '',
    createdAt: r.fecha_creacion?.toISOString?.() || r.fecha_creacion || '',
    updatedAt: r.fecha_actualizacion?.toISOString?.() || r.fecha_actualizacion || r.fecha_creacion || ''
  };
}

function containerOut(r) {
  return {
    id: pref('co', r.id),
    number: r.numero,
    origin: r.origen || '',
    departure: formatDateOnly(r.fecha_salida),
    eta: formatDateOnly(r.fecha_estimada),
    status: r.estado,
    notes: r.observaciones || ''
  };
}

function historyOut(r) {
  return {
    id: pref('h', r.id),
    userId: r.usuario_id ? pref('u', r.usuario_id) : '',
    action: r.accion,
    entity: r.tabla_afectada === 'clientes' ? 'client'
          : r.tabla_afectada === 'etiquetas' ? 'label'
          : r.tabla_afectada === 'contenedores' ? 'container'
          : r.tabla_afectada === 'usuarios' ? 'user'
          : r.tabla_afectada === 'recordatorios' ? 'reminder'
          : 'system',
    entityId: r.registro_id ? pref(r.tabla_afectada === 'clientes' ? 'c' : r.tabla_afectada === 'etiquetas' ? 'l' : r.tabla_afectada === 'contenedores' ? 'co' : r.tabla_afectada === 'usuarios' ? 'u' : 'r', r.registro_id) : '',
    createdAt: r.fecha?.toISOString?.() || r.fecha
  };
}

function reminderOut(r) {
  return {
    id: pref('r', r.id),
    title: r.titulo,
    notes: r.notas || '',
    clientId: r.cliente_id ? pref('c', r.cliente_id) : '',
    advisorId: r.asesora_id ? pref('u', r.asesora_id) : '',
    dueAt: r.fecha_hora,
    completed: !!r.completado
  };
}

function complaintOut(r) {
  return {
    id: pref('q', r.id),
    userId: r.usuario_id ? pref('u', r.usuario_id) : '',
    subject: r.asunto,
    detail: r.detalle,
    priority: r.prioridad,
    status: r.estado,
    response: r.respuesta || '',
    createdAt: r.creado_en,
    respondedAt: r.respondido_en || null,
    incidentDate: r.fecha_incidencia || r.creado_en,
    advisorCode: r.codigo_asesor || '',
    clientCode: r.codigo_cliente || '',
    labelCode: r.codigo_etiqueta || '',
    area: r.area_involucrada || 'logistica',
    evidence: r.evidencia || '',
    attachments: Array.isArray(r.attachments) ? r.attachments : []
  };
}

function teamNoteOut(r) {
  return {
    id: pref('n', r.id),
    userId: r.usuario_id ? pref('u', r.usuario_id) : '',
    text: r.texto,
    createdAt: r.creado_en
  };
}

function buildFamilySummaries(rows) {
  const byId = new Map(rows.map(r => [Number(r.id), r]));
  const children = new Map();
  for (const r of rows) {
    if (r.etiqueta_padre_id) {
      const p = Number(r.etiqueta_padre_id);
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(r);
    }
  }
  const out = new Map();
  for (const r of rows) {
    const rootId = Number(r.etiqueta_padre_id || r.id);
    const root = byId.get(rootId);
    if (!root) continue;
    const subs = children.get(rootId) || [];
    const expected = Number(root.cajas_packing_list || 0);
    const boxesRegistered = subs.reduce((sum, x) => sum + Number(x.cajas_packing_list || 0), 0);
    const remaining = Math.max(expected - boxesRegistered, 0);
    const progress = expected > 0 ? Math.min(100, Math.round((boxesRegistered / expected) * 100)) : 0;
    const cbmExpected = Number(root.cbm_packing_list || 0);
    const cbmMainReal = Number(root.cbm_real_china || 0);
    const cbmSubReal = subs.reduce((sum, x) => sum + Number(x.cbm_real_china || 0), 0);
    const cbmRealTotal = cbmMainReal + cbmSubReal;
    const cbmRemaining = Math.max(cbmExpected - cbmRealTotal, 0);
    out.set(Number(r.id), {
      childCount: subs.length,
      expected,
      boxesRegistered,
      remaining,
      progress,
      complete: expected > 0 && boxesRegistered >= expected,
      cbmExpected,
      cbmMainReal,
      cbmSubReal,
      cbmRealTotal,
      cbmRemaining
    });
  }
  return out;
}

/* ==========================================================================
   INICIALIZACIÓN DE ESQUEMA DE BASE DE DATOS Y SEEDING
   ========================================================================== */

async function ensureSchema() {
  // 1. Usuarios
  await db.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      rol VARCHAR(50) NOT NULL DEFAULT 'asesora',
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      codigo_asesora VARCHAR(30)
    )
  `);
  await db.query("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS codigo_asesora VARCHAR(30)");

  // 2. Clientes
  await db.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      codigo_cliente VARCHAR(50),
      nombre VARCHAR(150) NOT NULL,
      apellido VARCHAR(150),
      telefono VARCHAR(50),
      email VARCHAR(150),
      empresa VARCHAR(200),
      asesora_id INTEGER,
      estado VARCHAR(50) NOT NULL DEFAULT 'pending',
      estado_venezuela VARCHAR(80),
      fecha_primer_contacto DATE,
      tipo_mercancia VARCHAR(180),
      cajas_packing_list INTEGER,
      cajas_en_china INTEGER,
      cajas_recibidas_venezuela INTEGER,
      cbm_packing_list NUMERIC(12,3),
      cbm_real_china NUMERIC(12,3),
      observaciones TEXT,
      fecha_registro TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_cliente VARCHAR(50)");
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estado_venezuela VARCHAR(80)");
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS fecha_primer_contacto DATE");
  await db.query("ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_mercancia VARCHAR(180)");

  // 3. Contenedores
  await db.query(`
    CREATE TABLE IF NOT EXISTS contenedores (
      id SERIAL PRIMARY KEY,
      numero VARCHAR(100) UNIQUE NOT NULL,
      origen VARCHAR(150),
      fecha_salida DATE,
      fecha_estimada DATE,
      fecha_llegada DATE,
      estado VARCHAR(50) NOT NULL DEFAULT 'prep',
      observaciones TEXT
    )
  `);
  await db.query("ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS origen VARCHAR(150)");
  await db.query("ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS fecha_salida DATE");
  await db.query("ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS fecha_estimada DATE");
  await db.query("ALTER TABLE contenedores ADD COLUMN IF NOT EXISTS fecha_llegada DATE");

  // 4. Etiquetas
  await db.query(`
    CREATE TABLE IF NOT EXISTS etiquetas (
      id SERIAL PRIMARY KEY,
      numero VARCHAR(100) UNIQUE NOT NULL,
      cliente_id INTEGER,
      contenedor_id INTEGER,
      estado VARCHAR(50) NOT NULL DEFAULT 'prep',
      observaciones TEXT,
      lista BOOLEAN NOT NULL DEFAULT FALSE,
      tipo_mercancia TEXT,
      cajas_packing_list INTEGER,
      cajas_en_china INTEGER,
      cajas_recibidas_venezuela INTEGER,
      cbm_packing_list NUMERIC(12,3),
      cbm_real_china NUMERIC(12,3),
      familia_codigo VARCHAR(80),
      etiqueta_padre_id INTEGER,
      tiene_subetiquetas BOOLEAN NOT NULL DEFAULT FALSE,
      fecha_llegada_china DATE,
      fecha_salida_china DATE,
      fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fecha_actualizacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query("ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS lista BOOLEAN NOT NULL DEFAULT FALSE");
  await db.query("ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS tipo_mercancia TEXT");
  await db.query("ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS familia_codigo VARCHAR(80)");
  await db.query("ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS etiqueta_padre_id INTEGER");
  await db.query("ALTER TABLE etiquetas ADD COLUMN IF NOT EXISTS tiene_subetiquetas BOOLEAN NOT NULL DEFAULT FALSE");

  // 5. Historial, Recordatorios, Quejas, Notas
  await db.query(`CREATE TABLE IF NOT EXISTS historial (id SERIAL PRIMARY KEY, usuario_id INTEGER, accion VARCHAR(200), tabla_afectada VARCHAR(100), registro_id INTEGER, descripcion TEXT, fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS recordatorios (id SERIAL PRIMARY KEY, titulo VARCHAR(200) NOT NULL, notas TEXT, cliente_id INTEGER, asesora_id INTEGER, fecha_hora TIMESTAMP NOT NULL, completado BOOLEAN NOT NULL DEFAULT FALSE, creado_por INTEGER, fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS quejas (id SERIAL PRIMARY KEY, usuario_id INTEGER, asunto VARCHAR(200) NOT NULL, detalle TEXT NOT NULL, prioridad VARCHAR(30) NOT NULL DEFAULT 'normal', estado VARCHAR(30) NOT NULL DEFAULT 'pendiente', respuesta TEXT, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, respondido_en TIMESTAMP, fecha_incidencia DATE, codigo_asesor VARCHAR(50), codigo_cliente VARCHAR(50), codigo_etiqueta VARCHAR(50), area_involucrada VARCHAR(100), evidencia TEXT)`);
  await db.query(`CREATE TABLE IF NOT EXISTS queja_archivos (id SERIAL PRIMARY KEY, queja_id INTEGER NOT NULL, nombre_original VARCHAR(255) NOT NULL, nombre_guardado VARCHAR(255) NOT NULL, mime_type VARCHAR(150) NOT NULL, tamano BIGINT NOT NULL DEFAULT 0, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS notas_equipo (id SERIAL PRIMARY KEY, usuario_id INTEGER, texto TEXT NOT NULL, creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  // Actualizaciones de códigos por defecto
  await db.query("UPDATE usuarios SET codigo_asesora = 'ASE-' || LPAD(id::text, 3, '0') WHERE rol='asesora' AND (codigo_asesora IS NULL OR BTRIM(codigo_asesora)='')");
  await db.query("UPDATE clientes SET codigo_cliente = 'LC-CLI-' || LPAD(id::text, 6, '0') WHERE codigo_cliente IS NULL OR BTRIM(codigo_cliente) = ''");
}

async function seed() {
  if (typeof db.initCheck === 'function') {
    await db.initCheck();
  }
  await ensureSchema();

  // Limpieza de cuentas demo obsoletas
  const demoUsers = await db.query("SELECT id FROM usuarios WHERE lower(email) IN ('ana@ladincloud.local','maria@ladincloud.local') OR lower(nombre) IN ('ana gonzález','maría pérez','ana gonzalez','maria perez')");
  if (demoUsers.rows.length) {
    const ids = demoUsers.rows.map(r => r.id);
    await db.query('UPDATE clientes SET asesora_id=NULL WHERE asesora_id = ANY($1::int[])', [ids]);
    await db.query('DELETE FROM usuarios WHERE id = ANY($1::int[])', [ids]);
  }

  // Usuario Administrador por Defecto
  const users = [
    { name: 'Administrador', email: 'admin@ladincloud.local', pass: 'admin123', role: 'admin' }
  ];

  for (const u of users) {
    const existing = await db.query('SELECT id FROM usuarios WHERE email=$1', [u.email]);
    if (!existing.rows.length) {
      const hash = await bcrypt.hash(u.pass, 12);
      await db.query('INSERT INTO usuarios(nombre,email,password_hash,rol,activo) VALUES($1,$2,$3,$4,TRUE)', [u.name, u.email, hash, u.role]);
    } else {
      const hash = await bcrypt.hash(u.pass, 12);
      await db.query('UPDATE usuarios SET nombre=$1,password_hash=$2,rol=$3,activo=TRUE WHERE email=$4', [u.name, hash, u.role, u.email]);
    }
  }
}

/* ==========================================================================
   MIDDLEWARES & AUTENTICACIÓN
   ========================================================================== */

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'No autorizado' });
    const payload = jwt.verify(token, JWT_SECRET);
    const r = await db.query('SELECT * FROM usuarios WHERE id=$1 AND activo=TRUE', [payload.uid]);
    if (!r.rows.length) return res.status(401).json({ error: 'Usuario inactivo' });
    req.user = r.rows[0];
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}

async function logAction(userId, action, table, recordId, description = '') {
  try {
    await db.query('INSERT INTO historial(usuario_id,accion,tabla_afectada,registro_id,descripcion,fecha) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)', [
      userId, action, table, recordId, description || action
    ]);
  } catch (e) {
    console.error('Error registrando historial:', e.message);
  }
}

/* ==========================================================================
   RUTAS PRINCIPALES DE AUTENTICACIÓN Y BOOTSTRAP
   ========================================================================== */

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const r = await db.query('SELECT * FROM usuarios WHERE LOWER(email)=LOWER($1) AND activo=TRUE', [email || '']);
    if (!r.rows.length || !(await bcrypt.compare(password || '', r.rows[0].password_hash))) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    const user = r.rows[0];
    const token = jwt.sign({ uid: user.id }, JWT_SECRET, { expiresIn: '12h' });
    const bootstrap = await getBootstrap(user);
    res.json({ token, user: userOut(user), bootstrap });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error iniciando sesión' });
  }
});

async function getBootstrap(user) {
  const usersQ = await db.query('SELECT id,nombre,email,rol,activo,codigo_asesora FROM usuarios ORDER BY nombre');
  const clientsQ = user.rol === 'admin'
    ? await db.query('SELECT c.*,u.codigo_asesora FROM clientes c LEFT JOIN usuarios u ON u.id=c.asesora_id ORDER BY c.id DESC')
    : await db.query('SELECT c.*,u.codigo_asesora FROM clientes c LEFT JOIN usuarios u ON u.id=c.asesora_id WHERE c.asesora_id=$1 ORDER BY c.id DESC', [user.id]);

  const labelsQ = await db.query(
    user.rol === 'admin'
      ? 'SELECT * FROM etiquetas ORDER BY id DESC'
      : 'SELECT e.* FROM etiquetas e JOIN clientes c ON c.id=e.cliente_id WHERE c.asesora_id=$1 ORDER BY e.id DESC',
    user.rol === 'admin' ? [] : [user.id]
  );

  const containersQ = await db.query("SELECT id,numero,origen,TO_CHAR(fecha_salida,'YYYY-MM-DD') AS fecha_salida,TO_CHAR(fecha_estimada,'YYYY-MM-DD') AS fecha_estimada,estado,observaciones FROM contenedores ORDER BY id DESC");
  const historyQ = user.rol === 'admin' ? await db.query('SELECT * FROM historial ORDER BY fecha DESC LIMIT 200') : { rows: [] };
  const remindersQ = user.rol === 'admin' ? await db.query('SELECT * FROM recordatorios ORDER BY fecha_hora ASC') : await db.query('SELECT * FROM recordatorios WHERE asesora_id=$1 ORDER BY fecha_hora ASC', [user.id]);
  const complaintsQ = user.rol === 'admin' ? await db.query('SELECT * FROM quejas ORDER BY creado_en DESC') : await db.query('SELECT * FROM quejas WHERE usuario_id=$1 ORDER BY creado_en DESC', [user.id]);

  const complaintIds = complaintsQ.rows.map(r => Number(r.id)).filter(Boolean);
  let complaintFilesQ = { rows: [] };
  if (complaintIds.length) {
    complaintFilesQ = await db.query('SELECT id,queja_id,nombre_original,mime_type,tamano FROM queja_archivos WHERE queja_id=ANY($1::int[]) ORDER BY id', [complaintIds]);
  }

  const filesByComplaint = new Map();
  complaintFilesQ.rows.forEach(f => {
    const arr = filesByComplaint.get(Number(f.queja_id)) || [];
    arr.push({ id: pref('qa', f.id), name: f.nombre_original, mime: f.mime_type, size: Number(f.tamano || 0) });
    filesByComplaint.set(Number(f.queja_id), arr);
  });

  const complaints = complaintsQ.rows.map(r => complaintOut({ ...r, attachments: filesByComplaint.get(Number(r.id)) || [] }));
  await db.query("DELETE FROM notas_equipo WHERE creado_en < CURRENT_TIMESTAMP - INTERVAL '7 days'");
  const notesQ = await db.query('SELECT * FROM notas_equipo ORDER BY creado_en DESC LIMIT 100');
  const familySummaries = buildFamilySummaries(labelsQ.rows);

  return {
    users: usersQ.rows.map(userOut),
    clients: clientsQ.rows.map(clientOut),
    labels: labelsQ.rows.map(r => labelOut(r, familySummaries.get(Number(r.id)) || {})),
    containers: containersQ.rows.map(containerOut),
    history: historyQ.rows.map(historyOut),
    reminders: remindersQ.rows.map(reminderOut),
    complaints,
    teamNotes: notesQ.rows.map(teamNoteOut)
  };
}

app.get('/api/bootstrap', auth, async (req, res) => {
  try {
    res.json(await getBootstrap(req.user));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo cargar la información' });
  }
});

/* ==========================================================================
   GESTIÓN DE CLIENTES & REASIGNACIÓN
   ========================================================================== */

app.post('/api/clientes', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const advisorId = req.user.rol === 'admin' ? intId(b.advisorId) : req.user.id;
    if (!b.name) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!advisorId) return res.status(400).json({ error: 'Debes asignar una asesora' });

    const parts = String(b.name).trim().split(/\s+/);
    const nombre = parts.shift();
    const apellido = parts.join(' ') || null;
    const fc = /^\d{4}-\d{2}-\d{2}$/.test(String(b.firstContactDate || '')) ? String(b.firstContactDate) : null;

    const r = await db.query(
      `INSERT INTO clientes(codigo_cliente,nombre,apellido,telefono,email,empresa,asesora_id,estado,estado_venezuela,fecha_primer_contacto,observaciones)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b.code?.trim() || null, nombre, apellido, b.phone || null, b.email || null, b.company || null, advisorId, b.status || 'pending', b.state || null, fc, b.notes || null]
    );

    const final = await db.query('SELECT c.*,u.codigo_asesora FROM clientes c LEFT JOIN usuarios u ON u.id=c.asesora_id WHERE c.id=$1', [r.rows[0].id]);
    if (!final.rows[0].codigo_cliente) {
      const code = `LC-CLI-${String(final.rows[0].id).padStart(6, '0')}`;
      await db.query('UPDATE clientes SET codigo_cliente=$1 WHERE id=$2', [code, final.rows[0].id]);
      final.rows[0].codigo_cliente = code;
    }

    await logAction(req.user.id, `Cliente ${final.rows[0].codigo_cliente} creado`, 'clientes', final.rows[0].id, `Se creó a ${final.rows[0].nombre}${final.rows[0].apellido ? ' ' + final.rows[0].apellido : ''}. Estado: ${final.rows[0].estado}.`);
    res.status(201).json(clientOut(final.rows[0]));
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'El código de cliente ya existe' });
    res.status(500).json({ error: 'No se pudo crear el cliente' });
  }
});

app.put('/api/clientes/:id', auth, async (req, res) => {
  try {
    const id = intId(req.params.id);
    const old = await db.query('SELECT * FROM clientes WHERE id=$1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (req.user.rol !== 'admin' && old.rows[0].asesora_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso' });

    const b = req.body || {};
    const advisorId = req.user.rol === 'admin' ? intId(b.advisorId) : req.user.id;
    const parts = String(b.name || '').trim().split(/\s+/);
    const nombre = parts.shift() || '';
    const apellido = parts.join(' ') || null;
    const code = (b.code || old.rows[0].codigo_cliente || `LC-CLI-${String(id).padStart(6, '0')}`).trim();
    const fc = /^\d{4}-\d{2}-\d{2}$/.test(String(b.firstContactDate || '')) ? String(b.firstContactDate) : null;

    await db.query(
      `UPDATE clientes SET codigo_cliente=$1,nombre=$2,apellido=$3,telefono=$4,email=$5,empresa=$6,asesora_id=$7,estado=$8,estado_venezuela=$9,fecha_primer_contacto=$10,observaciones=$11,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id=$12`,
      [code, nombre, apellido, b.phone || null, b.email || null, b.company || null, advisorId, b.status || 'pending', b.state || null, fc, b.notes || null, id]
    );

    const final = await db.query('SELECT c.*,u.codigo_asesora FROM clientes c LEFT JOIN usuarios u ON u.id=c.asesora_id WHERE c.id=$1', [id]);
    await logAction(req.user.id, `Cliente ${code} actualizado`, 'clientes', id, `Se actualizaron los datos de ${final.rows[0].nombre}.`);
    res.json(clientOut(final.rows[0]));
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'El código de cliente ya existe' });
    res.status(500).json({ error: 'No se pudo actualizar el cliente' });
  }
});

app.delete('/api/clientes/:id', auth, async (req, res) => {
  let tx = null;
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede borrar clientes' });
    const id = intId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identificador de cliente no válido' });

    const old = await db.query('SELECT id,nombre,apellido,codigo_cliente FROM clientes WHERE id=$1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    tx = await db.connect();
    await tx.query('BEGIN');
    await tx.query('DELETE FROM etiquetas WHERE etiqueta_padre_id IN (SELECT id FROM etiquetas WHERE cliente_id=$1)', [id]);
    await tx.query('DELETE FROM etiquetas WHERE cliente_id=$1', [id]);
    await tx.query('DELETE FROM clientes WHERE id=$1', [id]);
    await tx.query('COMMIT');

    await logAction(req.user.id, `Cliente ${old.rows[0].nombre} eliminado`, 'clientes', id, `Se eliminó el cliente ${old.rows[0].codigo_cliente || ''}.`);
    res.json({ ok: true, deletedId: pref('c', id) });
  } catch (e) {
    if (tx) await tx.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el cliente' });
  } finally {
    tx?.release?.();
  }
});

app.post('/api/admin/reassign-clients', auth, async (req, res) => {
  let client;
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede reasignar carteras' });
    const sourceId = intId(req.body?.sourceAdvisorId);
    const targetIds = [...new Set((req.body?.targetAdvisorIds || []).map(intId).filter(Boolean))];
    const requestedIds = [...new Set((req.body?.clientIds || []).map(intId).filter(Boolean))];

    if (!sourceId) return res.status(400).json({ error: 'Debes indicar la asesora de origen' });
    if (!targetIds.length) return res.status(400).json({ error: 'Selecciona al menos una asesora destino' });

    const source = await db.query('SELECT id,nombre,rol FROM usuarios WHERE id=$1', [sourceId]);
    if (!source.rows.length || source.rows[0].rol !== 'asesora') return res.status(400).json({ error: 'La asesora de origen no es válida' });

    const targets = await db.query("SELECT id,nombre FROM usuarios WHERE id=ANY($1::int[]) AND rol='asesora' AND activo=TRUE", [targetIds]);
    if (targets.rows.length !== targetIds.length) return res.status(400).json({ error: 'Todas las asesoras destino deben estar activas' });

    let where = 'asesora_id=$1', params = [sourceId];
    if (requestedIds.length) {
      where += ' AND id=ANY($2::int[])';
      params.push(requestedIds);
    }

    const clients = await db.query(`SELECT id,codigo_cliente FROM clientes WHERE ${where} ORDER BY id`, params);
    if (!clients.rows.length) return res.status(400).json({ error: 'No hay clientes seleccionados para reasignar' });

    client = await db.connect();
    await client.query('BEGIN');
    const distribution = {};
    for (let i = 0; i < clients.rows.length; i++) {
      const target = targets.rows[i % targets.rows.length];
      await client.query('UPDATE clientes SET asesora_id=$1,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id=$2', [target.id, clients.rows[i].id]);
      await client.query('INSERT INTO historial(usuario_id,accion,tabla_afectada,registro_id,descripcion) VALUES($1,$2,$3,$4,$5)', [
        req.user.id, `Cliente ${clients.rows[i].codigo_cliente || clients.rows[i].id} reasignado a ${target.nombre}`, 'clientes', clients.rows[i].id, `Reasignado desde ${source.rows[0].nombre} a ${target.nombre}`
      ]);
      distribution[target.id] = (distribution[target.id] || 0) + 1;
    }
    await client.query('COMMIT');

    const labels = await db.query('SELECT COUNT(*)::int AS n FROM etiquetas e WHERE e.cliente_id=ANY($1::int[])', [clients.rows.map(r => r.id)]);
    res.json({ ok: true, moved: clients.rows.length, labels: labels.rows[0].n, distribution });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'No se pudo reasignar la cartera' });
  } finally {
    if (client) client.release?.();
  }
});

/* ==========================================================================
   GESTIÓN DE CONTENEDORES
   ========================================================================== */

app.post('/api/contenedores', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede administrar contenedores' });
    const b = req.body || {};
    const cleanDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
    const r = await db.query(
      `INSERT INTO contenedores(numero,origen,fecha_salida,fecha_estimada,fecha_llegada,estado,observaciones)
       VALUES($1,$2,NULLIF($3,'')::date,NULLIF($4,'')::date,NULL,$5,$6)
       RETURNING id,numero,origen,TO_CHAR(fecha_salida,'YYYY-MM-DD') AS fecha_salida,TO_CHAR(fecha_estimada,'YYYY-MM-DD') AS fecha_estimada,estado,observaciones`,
      [b.number, b.origin || null, cleanDate(b.departure) || '', cleanDate(b.eta) || '', b.status || 'prep', b.notes || null]
    );
    await logAction(req.user.id, `Contenedor ${b.number} creado`, 'contenedores', r.rows[0].id, `Se creó el contenedor ${b.number}.`);
    res.status(201).json(containerOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Ese contenedor ya existe' });
    res.status(500).json({ error: 'No se pudo crear el contenedor' });
  }
});

app.put('/api/contenedores/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede administrar contenedores' });
    const id = intId(req.params.id);
    const b = req.body || {};
    const cleanDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;

    const r = await db.query(
      `UPDATE contenedores SET numero=$1,origen=$2,fecha_salida=NULLIF($3,'')::date,fecha_estimada=NULLIF($4,'')::date,estado=$5,observaciones=$6 WHERE id=$7
       RETURNING id,numero,origen,TO_CHAR(fecha_salida,'YYYY-MM-DD') AS fecha_salida,TO_CHAR(fecha_estimada,'YYYY-MM-DD') AS fecha_estimada,estado,observaciones`,
      [b.number, b.origin || null, cleanDate(b.departure) || '', cleanDate(b.eta) || '', b.status || 'prep', b.notes || null, id]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Contenedor no encontrado' });
    await logAction(req.user.id, `Contenedor ${b.number} actualizado`, 'contenedores', id, `Se actualizaron datos del contenedor.`);
    res.json(containerOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el contenedor' });
  }
});

app.delete('/api/contenedores/:id', auth, async (req, res) => {
  let tx = null;
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede administrar contenedores' });
    const id = intId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identificador de contenedor no válido' });

    const old = await db.query('SELECT id,numero FROM contenedores WHERE id=$1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Contenedor no encontrado' });

    tx = await db.connect();
    await tx.query('BEGIN');
    await tx.query('UPDATE etiquetas SET contenedor_id=NULL,fecha_actualizacion=CURRENT_TIMESTAMP WHERE contenedor_id=$1', [id]);
    await tx.query('DELETE FROM contenedores WHERE id=$1', [id]);
    await tx.query('COMMIT');

    await logAction(req.user.id, `Contenedor ${old.rows[0].numero} eliminado`, 'contenedores', id, `Se eliminó el contenedor.`);
    res.json({ ok: true, deletedId: pref('co', id) });
  } catch (e) {
    if (tx) await tx.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el contenedor' });
  } finally {
    tx?.release?.();
  }
});

/* ==========================================================================
   GESTIÓN DE ETIQUETAS Y FAMILIAS (SUBETIQUETAS)
   ========================================================================== */

app.post('/api/etiquetas', auth, async (req, res) => {
  try {
    const b = req.body || {}, clientId = intId(b.clientId), containerId = b.containerId ? intId(b.containerId) : null;
    if ((!b.number && !b.parentLabelId) || !clientId) return res.status(400).json({ error: 'Número y cliente son obligatorios' });

    const c = await db.query('SELECT asesora_id FROM clientes WHERE id=$1', [clientId]);
    if (!c.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    if (req.user.rol !== 'admin' && c.rows[0].asesora_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso' });

    const parentId = b.parentLabelId ? intId(b.parentLabelId) : null;
    let familyCode = null, hasSubs = !!b.hasSubLabels, labelNumber = String(b.number || '').trim();
    let boxesPacking = b.boxesPacking === '' || b.boxesPacking == null ? null : intVal(b.boxesPacking),
        boxesChina = b.boxesChina === '' || b.boxesChina == null ? null : intVal(b.boxesChina),
        cbmPacking = b.cbmPacking === '' || b.cbmPacking == null ? null : numVal(b.cbmPacking),
        cbmChina = b.cbmChina === '' || b.cbmChina == null ? null : numVal(b.cbmChina);

    if (parentId) {
      const p = await db.query('SELECT id,numero,cliente_id,familia_codigo,etiqueta_padre_id,cajas_packing_list,cajas_en_china,cbm_packing_list,cbm_real_china FROM etiquetas WHERE id=$1', [parentId]);
      if (!p.rows.length) return res.status(404).json({ error: 'Etiqueta principal no encontrada' });
      const root = p.rows[0];
      if (Number(root.cliente_id) !== clientId) return res.status(400).json({ error: 'La subetiqueta debe pertenecer al mismo cliente' });
      if (root.etiqueta_padre_id) return res.status(400).json({ error: 'Solo una etiqueta principal puede tener subetiquetas' });

      if (!labelNumber) {
        const q = await db.query("SELECT COALESCE(MAX(substring(numero from '-([0-9]+)$')::int),0)+1 AS n FROM etiquetas WHERE etiqueta_padre_id=$1 AND numero ~ '-[0-9]+$'", [parentId]);
        labelNumber = `${root.numero}-${Number(q.rows[0]?.n || 1)}`;
      }

      const boxExpected = Number(root.cajas_packing_list || 0), boxBase = Number(root.cajas_en_china || 0);
      const boxQ = await db.query('SELECT COALESCE(SUM(cajas_packing_list),0)::int AS n FROM etiquetas WHERE etiqueta_padre_id=$1', [parentId]);
      const boxSubs = Number(boxQ.rows[0]?.n || 0), incomingBoxes = Math.max(0, Number(boxesPacking || 0)), boxAvailable = Math.max(boxExpected - boxBase - boxSubs, 0);

      if (boxExpected > 0 && incomingBoxes > boxAvailable) return res.status(400).json({ error: `Las subetiquetas no pueden registrar más de ${boxAvailable} cajas disponibles.` });

      const cbmExpected = Number(root.cbm_packing_list || 0), cbmBase = Number(root.cbm_real_china || 0);
      const cbmQ = await db.query('SELECT COALESCE(SUM(cbm_real_china),0) AS n FROM etiquetas WHERE etiqueta_padre_id=$1', [parentId]);
      const cbmSubs = Number(cbmQ.rows[0]?.n || 0), cbmAvailable = Math.max(cbmExpected - cbmBase - cbmSubs, 0);

      cbmPacking = cbmAvailable;
      boxesPacking = boxesPacking == null ? 0 : boxesPacking;
      boxesChina = null;
      familyCode = null;
      hasSubs = false;
      await db.query('UPDATE etiquetas SET tiene_subetiquetas=TRUE WHERE id=$1', [parentId]);
    }

    const cleanDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
    const status = b.status === 'done' ? 'facturado' : (b.status || 'prep');

    const r = await db.query(
      `INSERT INTO etiquetas(numero,cliente_id,contenedor_id,estado,observaciones,tipo_mercancia,cajas_packing_list,cajas_en_china,cajas_recibidas_venezuela,cbm_packing_list,cbm_real_china,familia_codigo,etiqueta_padre_id,tiene_subetiquetas,fecha_llegada_china,fecha_salida_china)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULLIF($15,'')::date,NULLIF($16,'')::date) RETURNING *`,
      [labelNumber, clientId, containerId, status, b.notes || null, b.cargoType || null, boxesPacking, boxesChina, null, cbmPacking, cbmChina, familyCode, parentId, hasSubs, cleanDate(b.arrivalChina) || '', null]
    );

    await logAction(req.user.id, `Etiqueta ${labelNumber} agregada`, 'etiquetas', r.rows[0].id, `Se creó la etiqueta ${labelNumber}.`);
    res.status(201).json(labelOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Esa etiqueta ya existe' });
    res.status(500).json({ error: 'No se pudo crear la etiqueta' });
  }
});

app.put('/api/etiquetas/:id', auth, async (req, res) => {
  try {
    const id = intId(req.params.id);
    const oldQ = await db.query('SELECT e.*,c.asesora_id,(SELECT COUNT(*) FROM etiquetas x WHERE x.etiqueta_padre_id=e.id) AS child_count FROM etiquetas e LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=$1', [id]);
    if (!oldQ.rows.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const old = oldQ.rows[0];
    if (req.user.rol !== 'admin' && old.asesora_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso' });

    const b = req.body || {}, clientId = intId(b.clientId), containerId = b.containerId ? intId(b.containerId) : null, parentId = b.parentLabelId ? intId(b.parentLabelId) : null;
    let labelNumber = String(b.number || old.numero).trim(), familyCode = old.familia_codigo || null, hasSubs = !!b.hasSubLabels;
    let boxesPacking = b.boxesPacking === '' || b.boxesPacking == null ? null : intVal(b.boxesPacking),
        boxesChina = b.boxesChina === '' || b.boxesChina == null ? null : intVal(b.boxesChina),
        cbmPacking = b.cbmPacking === '' || b.cbmPacking == null ? null : numVal(b.cbmPacking),
        cbmChina = b.cbmChina === '' || b.cbmChina == null ? null : numVal(b.cbmChina);

    const status = b.status === 'done' ? 'facturado' : (b.status || 'prep');
    const r = await db.query(
      `UPDATE etiquetas SET numero=$1,cliente_id=$2,contenedor_id=$3,estado=$4,observaciones=$5,lista=$6,tipo_mercancia=$7,cajas_packing_list=$8,cajas_en_china=$9,cajas_recibidas_venezuela=NULL,cbm_packing_list=$10,cbm_real_china=$11,familia_codigo=$12,etiqueta_padre_id=$13,tiene_subetiquetas=$14,fecha_llegada_china=NULL,fecha_salida_china=NULL,fecha_actualizacion=CURRENT_TIMESTAMP WHERE id=$15 RETURNING *`,
      [labelNumber, clientId, containerId, status, b.notes || null, !!b.ready, b.cargoType || null, boxesPacking, boxesChina, cbmPacking, cbmChina, familyCode, parentId, hasSubs, id]
    );

    await logAction(req.user.id, `Etiqueta ${labelNumber} actualizada`, 'etiquetas', id, `Se actualizó la etiqueta.`);
    res.json(labelOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ error: 'Esa etiqueta ya existe' });
    res.status(500).json({ error: 'No se pudo actualizar la etiqueta' });
  }
});

app.delete('/api/etiquetas/:id', auth, async (req, res) => {
  const client = await db.connect().catch(() => null);
  try {
    const id = intId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Identificador de etiqueta no válido' });
    const old = await db.query(`SELECT e.id,e.numero,e.etiqueta_padre_id,e.cliente_id,c.asesora_id FROM etiquetas e LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=$1`, [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    if (req.user.rol !== 'admin' && old.rows[0].asesora_id !== req.user.id) return res.status(403).json({ error: 'No tienes permiso para eliminar esta etiqueta' });

    if (client) await client.query('BEGIN');
    const q = (text, params) => client ? client.query(text, params) : db.query(text, params);
    const parentId = old.rows[0].etiqueta_padre_id;
    let deletedNumbers = [];

    if (!parentId) {
      const children = await q('SELECT id,numero FROM etiquetas WHERE etiqueta_padre_id=$1', [id]);
      deletedNumbers = children.rows.map(r => r.numero);
      if (children.rows.length) await q('DELETE FROM etiquetas WHERE etiqueta_padre_id=$1', [id]);
    } else {
      deletedNumbers = [old.rows[0].numero];
    }
    await q('DELETE FROM etiquetas WHERE id=$1', [id]);
    if (parentId) {
      await q('UPDATE etiquetas SET tiene_subetiquetas=EXISTS(SELECT 1 FROM etiquetas x WHERE x.etiqueta_padre_id=$1) WHERE id=$1', [parentId]);
    }
    if (client) await client.query('COMMIT');

    await logAction(req.user.id, `Etiqueta ${old.rows[0].numero} eliminada`, 'etiquetas', id, `Se eliminó la etiqueta.`);
    res.json({ ok: true, deleted: deletedNumbers.length + 1 });
  } catch (e) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar la etiqueta' });
  } finally {
    client?.release?.();
  }
});

/* ==========================================================================
   INCIDENCIAS / QUEJAS CON FORMATO PDF Y ARCHIVOS ADJUNTOS
   ========================================================================== */

const complaintUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 15, fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^(image\/(jpeg|png)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/plain|text\/csv)$/i.test(String(file.mimetype || ''));
    cb(allowed ? null : new Error('Tipo de archivo no permitido.'), allowed);
  }
});

app.post('/api/quejas', auth, complaintUpload.array('files', 15), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.subject || !b.detail || !b.incidentDate) return res.status(400).json({ error: 'Fecha, tipo de incidencia y detalle son obligatorios' });
    const advisorQ = await db.query('SELECT codigo_asesora FROM usuarios WHERE id=$1', [req.user.id]);
    const advisorCode = String(b.advisorCode || advisorQ.rows[0]?.codigo_asesora || '').trim() || null;
    const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.incidentDate)) ? String(b.incidentDate) : null;

    const r = await db.query(
      `INSERT INTO quejas(usuario_id,asunto,detalle,prioridad,estado,fecha_incidencia,codigo_asesor,codigo_cliente,codigo_etiqueta,area_involucrada,evidencia)
       VALUES($1,$2,$3,$4,'pendiente',$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user.id, String(b.subject).trim(), String(b.detail).trim(), b.priority || 'medio', cleanDate, advisorCode, b.clientCode || null, b.labelCode || null, b.area || 'logistica', b.evidence || null]
    );

    const complaintId = Number(r.rows[0].id);
    const dir = path.join(UPLOAD_ROOT, pref('q', complaintId));
    fs.mkdirSync(dir, { recursive: true });

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length) {
      for (const f of files) {
        const ext = path.extname(String(f.originalname || '')).toLowerCase().replace(/[^a-z0-9.]/g, '');
        const stored = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
        fs.writeFileSync(path.join(dir, stored), f.buffer);
        await db.query('INSERT INTO queja_archivos(queja_id,nombre_original,nombre_guardado,mime_type,tamano) VALUES($1,$2,$3,$4,$5)', [
          complaintId, f.originalname, stored, f.mimetype, f.size
        ]);
      }
    }

    await logAction(req.user.id, `Incidencia enviada: ${b.subject}`, 'quejas', complaintId, `Registrada por ${req.user.nombre}.`);
    const at = await db.query('SELECT id,nombre_original,mime_type,tamano FROM queja_archivos WHERE queja_id=$1 ORDER BY id', [complaintId]);
    res.status(201).json(complaintOut({ ...r.rows[0], attachments: at.rows.map(f => ({ id: pref('qa', f.id), name: f.nombre_original, mime: f.mime_type, size: Number(f.tamano || 0) })) }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'No se pudo registrar la incidencia' });
  }
});

app.get('/api/quejas', auth, async (req, res) => {
  try {
    const r = req.user.rol === 'admin'
      ? await db.query('SELECT * FROM quejas ORDER BY creado_en DESC')
      : await db.query('SELECT * FROM quejas WHERE usuario_id=$1 ORDER BY creado_en DESC', [req.user.id]);
    res.json(r.rows.map(complaintOut));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron cargar las incidencias' });
  }
});

app.get('/api/quejas/:id/pdf', auth, async (req, res) => {
  try {
    const id = intId(req.params.id);
    const q = await db.query('SELECT * FROM quejas WHERE id=$1', [id]);
    if (!q.rows.length) return res.status(404).json({ error: 'Incidencia no encontrada' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="INC-${String(id).padStart(4, '0')}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    doc.pipe(res);
    doc.font('Helvetica-Bold').fontSize(18).text(`LADIN CLOUD - INCIDENCIA INC-${String(id).padStart(4, '0')}`);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10).text(`Fecha: ${q.rows[0].fecha_incidencia || q.rows[0].creado_en}`);
    doc.text(`Asunto: ${q.rows[0].asunto}`);
    doc.text(`Prioridad: ${q.rows[0].prioridad}`);
    doc.text(`Estado: ${q.rows[0].estado}`);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').text('Detalle:');
    doc.font('Helvetica').text(q.rows[0].detalle);
    if (q.rows[0].respuesta) {
      doc.moveDown(1);
      doc.font('Helvetica-Bold').text('Respuesta Administración:');
      doc.font('Helvetica').text(q.rows[0].respuesta);
    }
    doc.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error generando PDF' });
  }
});

app.put('/api/quejas/:id', auth, async (req, res) => {
  try {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede responder incidencias' });
    const id = intId(req.params.id);
    const old = await db.query('SELECT * FROM quejas WHERE id=$1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Incidencia no encontrada' });

    const b = req.body || {};
    let status = b.status || old.rows[0].estado;
    const response = String(b.response ?? old.rows[0].respuesta ?? '').trim();
    if (response && status === 'pendiente') status = 'respondida';

    const r = await db.query(`UPDATE quejas SET estado=$1,respuesta=$2,respondido_en=CASE WHEN $2<>'' THEN CURRENT_TIMESTAMP ELSE respondido_en END WHERE id=$3 RETURNING *`, [status, response, id]);
    await logAction(req.user.id, `Incidencia ${id} actualizada`, 'quejas', id, `Respuesta registrada.`);
    res.json(complaintOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo guardar la respuesta' });
  }
});

/* ==========================================================================
   RECORDATORIOS Y NOTAS DE EQUIPO
   ========================================================================== */

app.get('/api/team-notes', auth, async (req, res) => {
  try {
    await db.query("DELETE FROM notas_equipo WHERE creado_en < CURRENT_TIMESTAMP - INTERVAL '7 days'");
    const r = await db.query('SELECT * FROM notas_equipo ORDER BY creado_en DESC LIMIT 100');
    res.json(r.rows.map(teamNoteOut));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron cargar las notas' });
  }
});

app.post('/api/team-notes', auth, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'La nota no puede estar vacía' });
    await db.query("DELETE FROM notas_equipo WHERE creado_en < CURRENT_TIMESTAMP - INTERVAL '7 days'");
    const r = await db.query('INSERT INTO notas_equipo(usuario_id,texto) VALUES($1,$2) RETURNING *', [req.user.id, text]);
    res.status(201).json(teamNoteOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo publicar la nota' });
  }
});

app.post('/api/reminders', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const advisorId = b.advisorId ? intId(b.advisorId) : null;
    const clientId = b.clientId ? intId(b.clientId) : null;
    if (!b.title || !b.dueAt) return res.status(400).json({ error: 'Título y fecha son obligatorios' });

    const r = await db.query('INSERT INTO recordatorios(titulo,notas,cliente_id,asesora_id,fecha_hora,completado,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [
      String(b.title).trim(), b.notes || null, clientId, advisorId, b.dueAt, !!b.completed, req.user.id
    ]);
    res.status(201).json(reminderOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo crear el recordatorio' });
  }
});

app.put('/api/reminders/:id', auth, async (req, res) => {
  try {
    const id = intId(req.params.id);
    const old = await db.query('SELECT * FROM recordatorios WHERE id=$1', [id]);
    if (!old.rows.length) return res.status(404).json({ error: 'Recordatorio no encontrado' });

    const b = req.body || {};
    const title = String(b.title ?? old.rows[0].titulo).trim();
    const notes = b.notes ?? old.rows[0].notas;
    const dueAt = b.dueAt || old.rows[0].fecha_hora;
    const completed = !!b.completed;

    const r = await db.query('UPDATE recordatorios SET titulo=$1,notas=$2,fecha_hora=$3,completado=$4 WHERE id=$5 RETURNING *', [title, notes, dueAt, completed, id]);
    res.json(reminderOut(r.rows[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo actualizar el recordatorio' });
  }
});

app.delete('/api/reminders/:id', auth, async (req, res) => {
  try {
    const id = intId(req.params.id);
    await db.query('DELETE FROM recordatorios WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar el recordatorio' });
  }
});

/* ==========================================================================
   EXPORTACIÓN & RESPALDO DE SEGURIDAD (BACKUP ZIP CSV)
   ========================================================================== */

function csvEscapeValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    value = value.toISOString();
  } else if (typeof value === 'object') {
    try { value = JSON.stringify(value); } catch { value = String(value); }
  }
  const str = String(value).replace(/\r?\n/g, '\n');
  return /[";\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function rowsToExcelCsv(rows) {
  const cols = [];
  for (const row of rows) {
    for (const k of Object.keys(row || {})) {
      if (!cols.includes(k)) cols.push(k);
    }
  }
  const header = cols.map(csvEscapeValue).join(';');
  const lines = rows.map(row => cols.map(k => csvEscapeValue(row?.[k])).join(';'));
  return '\uFEFF' + [header, ...lines].join('\r\n') + '\r\n';
}

app.get('/api/admin/backup-csv.zip', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede descargar copias de seguridad' });
  try {
    const [clientesQ, etiquetasQ, contenedoresQ] = await Promise.all([
      db.query('SELECT * FROM clientes ORDER BY id'),
      db.query('SELECT * FROM etiquetas ORDER BY id'),
      db.query('SELECT * FROM contenedores ORDER BY id')
    ]);

    const stamp = new Date();
    const pad = n => String(n).padStart(2, '0');
    const filename = `LadinCloud_Backup_${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}-${pad(stamp.getMinutes())}-${pad(stamp.getSeconds())}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => {
      console.error('CSV ZIP error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar la copia' });
    });
    archive.pipe(res);
    archive.append(rowsToExcelCsv(clientesQ.rows), { name: 'clientes.csv' });
    archive.append(rowsToExcelCsv(etiquetasQ.rows), { name: 'etiquetas.csv' });
    archive.append(rowsToExcelCsv(contenedoresQ.rows), { name: 'contenedores.csv' });
    await archive.finalize();
  } catch (e) {
    console.error('CSV backup error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar la copia' });
  }
});

/* ==========================================================================
   CATCH-ALL / SERVIR APLICACIÓN FRONTEND
   ========================================================================== */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ==========================================================================
   INICIALIZACIÓN DEL SERVIDOR
   ========================================================================== */

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

seed()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      const localIps = getLocalIpAddresses();
      console.log('====================================================');
      console.log(`🚀 LADIN CLOUD Servidor Activo en Puerto ${PORT}`);
      console.log(`📍 Acceso Local:  http://localhost:${PORT}`);
      if (localIps.length) {
        localIps.forEach(ip => console.log(`🌐 Acceso Red:    http://${ip}:${PORT}`));
      }
      console.log('====================================================');
    });
  })
  .catch(err => {
    console.error('❌ Error iniciando Ladin Cloud:', err);
    process.exit(1);
  });
