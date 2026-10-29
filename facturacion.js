/**
 * Facturación de servicios, pagos y comisiones por asesor.
 *
 * - Factura de servicios (formato «Factura_Servicios»): cliente, líneas con cajas / CBM / peso, tarifa de flete marítimo
 *   y terrestre, extra de despacho y total en USD. Se arma desde las etiquetas del cliente.
 * - Pagos: abonos por factura; el estado (pendiente / parcial / pagada) se deriva de lo abonado.
 * - Comisiones: se generan al emitir la factura con la regla vigente del asesor (o la global) y quedan guardadas con la
 *   regla y la tasa usadas. El administrador puede cambiar reglas, recalcular las pendientes y marcarlas como pagadas.
 *
 * Permisos: solo el administrador crea, anula y registra pagos (así nadie se genera sus propias comisiones).
 * Cada asesor ve únicamente sus facturas y sus comisiones.
 */
const PDFDocument = require('pdfkit');

const TARIFA_MARITIMA = 660; // USD por CBM, igual que el cotizador de la web
const REGLAS = {
  porcentaje_total: 'Porcentaje sobre el total de la factura',
  porcentaje_flete: 'Porcentaje sobre el flete marítimo (CBM × tarifa)',
  fijo_cbm: 'Monto fijo por CBM',
};
const REGLA_POR_DEFECTO = { tipo: 'porcentaje_total', valor: 0 };

/* ---------- utilidades ---------- */

const num = (v) => {
  if (v === '' || v == null) return NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const texto = (v, max) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? String(v) : '');

/** Monto de una línea: flete marítimo + traslado terrestre + extra de despacho. */
function montoLinea({ cbm, tarifaMaritima, volumenTerrestre, tarifaTerrestre, extra }) {
  return r2(cbm * tarifaMaritima + volumenTerrestre * tarifaTerrestre + extra);
}

function calcularComision(regla, items, total) {
  const valor = Number(regla.valor) || 0;
  const cbm = r3(items.reduce((s, i) => s + i.cbm, 0));
  if (regla.tipo === 'fijo_cbm') return { base: cbm, monto: r2(cbm * valor) };
  const base = regla.tipo === 'porcentaje_flete' ? r2(items.reduce((s, i) => s + i.cbm * i.tarifaMaritima, 0)) : total;
  return { base, monto: r2((base * valor) / 100) };
}

async function reglaDe(db, asesoraId) {
  const propia = asesoraId ? (await db.query('SELECT tipo,valor FROM comision_reglas WHERE asesora_id=$1', [asesoraId])).rows[0] : null;
  const regla = propia || (await db.query('SELECT tipo,valor FROM comision_reglas WHERE asesora_id IS NULL')).rows[0] || REGLA_POR_DEFECTO;
  return { tipo: regla.tipo, valor: Number(regla.valor) };
}

/* ---------- esquema ---------- */

async function ensureSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS facturas (
    id SERIAL PRIMARY KEY, codigo VARCHAR(40) UNIQUE,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    asesora_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_factura DATE NOT NULL, fecha_pedido DATE, fecha_carga DATE, fecha_estimada_llegada DATE,
    direccion VARCHAR(250), metodo_envio VARCHAR(100), metodo_pago VARCHAR(100), modo_entrega VARCHAR(100),
    forma_declarar VARCHAR(100), otros_servicios VARCHAR(250), observaciones TEXT,
    total NUMERIC(12,2) NOT NULL DEFAULT 0, pagado NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'emitida', creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS factura_items (
    id SERIAL PRIMARY KEY, factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    etiqueta_id INTEGER REFERENCES etiquetas(id) ON DELETE SET NULL, descripcion VARCHAR(250) NOT NULL,
    cajas INTEGER NOT NULL DEFAULT 0, cbm NUMERIC(12,3) NOT NULL DEFAULT 0, peso NUMERIC(12,2) NOT NULL DEFAULT 0,
    tarifa_maritima NUMERIC(10,2) NOT NULL DEFAULT 660, volumen_terrestre NUMERIC(12,3) NOT NULL DEFAULT 0,
    tarifa_terrestre NUMERIC(10,2) NOT NULL DEFAULT 0, extra NUMERIC(10,2) NOT NULL DEFAULT 0,
    monto NUMERIC(12,2) NOT NULL DEFAULT 0)`);
  await db.query(`CREATE TABLE IF NOT EXISTS factura_pagos (
    id SERIAL PRIMARY KEY, factura_id INTEGER NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
    fecha DATE NOT NULL, monto NUMERIC(12,2) NOT NULL, metodo VARCHAR(100), referencia VARCHAR(150),
    creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await db.query(`CREATE TABLE IF NOT EXISTS comision_reglas (
    id SERIAL PRIMARY KEY, asesora_id INTEGER UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL, valor NUMERIC(10,3) NOT NULL DEFAULT 0)`);
  await db.query(`CREATE TABLE IF NOT EXISTS comisiones (
    id SERIAL PRIMARY KEY, factura_id INTEGER NOT NULL UNIQUE REFERENCES facturas(id) ON DELETE CASCADE,
    asesora_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL, cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    base NUMERIC(12,3) NOT NULL DEFAULT 0, regla VARCHAR(30) NOT NULL, tasa NUMERIC(10,3) NOT NULL DEFAULT 0,
    monto NUMERIC(12,2) NOT NULL DEFAULT 0, estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    fecha_pago DATE, pagado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
}

/* ---------- rutas ---------- */

function registrar(app, { db, auth, intId, logAction, PDFKit = PDFDocument }) {
  const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede hacer esto' }));
  const FACTURA_SQL = `SELECT f.id,f.codigo,f.cliente_id,f.asesora_id,TO_CHAR(f.fecha_factura,'YYYY-MM-DD') AS fecha_factura,
      TO_CHAR(f.fecha_pedido,'YYYY-MM-DD') AS fecha_pedido,TO_CHAR(f.fecha_carga,'YYYY-MM-DD') AS fecha_carga,
      TO_CHAR(f.fecha_estimada_llegada,'YYYY-MM-DD') AS fecha_estimada_llegada,f.direccion,f.metodo_envio,f.metodo_pago,
      f.modo_entrega,f.forma_declarar,f.otros_servicios,f.observaciones,f.total,f.pagado,f.estado,f.fecha_creacion,
      c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,c.codigo_cliente,c.telefono AS cliente_telefono,
      u.nombre AS asesora_nombre,u.codigo_asesora
    FROM facturas f JOIN clientes c ON c.id=f.cliente_id LEFT JOIN usuarios u ON u.id=f.asesora_id`;

  const estadoPago = (f) => (f.estado === 'anulada' ? 'anulada' : Number(f.pagado) <= 0 ? 'pendiente' : Number(f.pagado) + 0.005 >= Number(f.total) ? 'pagada' : 'parcial');

  const facturaOut = (f) => ({
    id: String(f.id), codigo: f.codigo, clientId: `c${f.cliente_id}`, clientCode: f.codigo_cliente || '',
    clientName: [f.cliente_nombre, f.cliente_apellido].filter(Boolean).join(' '), clientPhone: f.cliente_telefono || '',
    advisorId: f.asesora_id ? `u${f.asesora_id}` : '', advisorName: f.asesora_nombre || '', advisorCode: f.codigo_asesora || '',
    date: f.fecha_factura, orderDate: f.fecha_pedido || '', loadDate: f.fecha_carga || '', eta: f.fecha_estimada_llegada || '',
    address: f.direccion || '', shipping: f.metodo_envio || '', paymentMethod: f.metodo_pago || '', delivery: f.modo_entrega || '',
    declaration: f.forma_declarar || '', otherServices: f.otros_servicios || '', notes: f.observaciones || '',
    total: Number(f.total), paid: Number(f.pagado), balance: r2(Number(f.total) - Number(f.pagado)),
    status: f.estado, paymentStatus: estadoPago(f), createdAt: iso(f.fecha_creacion),
  });

  const itemOut = (i) => ({
    id: String(i.id), labelId: i.etiqueta_id ? `l${i.etiqueta_id}` : '', description: i.descripcion, boxes: Number(i.cajas),
    cbm: Number(i.cbm), weight: Number(i.peso), seaRate: Number(i.tarifa_maritima), landVolume: Number(i.volumen_terrestre),
    landRate: Number(i.tarifa_terrestre), extra: Number(i.extra), amount: Number(i.monto),
  });

  const pagoOut = (p) => ({ id: String(p.id), date: p.fecha, amount: Number(p.monto), method: p.metodo || '', reference: p.referencia || '', createdAt: iso(p.fecha_creacion) });

  const comisionOut = (c) => ({
    id: String(c.id), invoiceId: String(c.factura_id), invoiceCode: c.factura_codigo, invoiceDate: c.fecha_factura, invoiceTotal: Number(c.factura_total),
    invoiceStatus: c.factura_estado, advisorId: c.asesora_id ? `u${c.asesora_id}` : '', advisorName: c.asesora_nombre || '',
    clientId: c.cliente_id ? `c${c.cliente_id}` : '', clientCode: c.codigo_cliente || '', clientName: [c.cliente_nombre, c.cliente_apellido].filter(Boolean).join(' '),
    base: Number(c.base), rule: c.regla, ruleLabel: REGLAS[c.regla] || c.regla, rate: Number(c.tasa), amount: Number(c.monto),
    status: c.estado, paidDate: c.fecha_pago || '',
  });

  async function cargarFactura(id, user) {
    const r = await db.query(`${FACTURA_SQL} WHERE f.id=$1`, [id]);
    const f = r.rows[0];
    if (!f) return { error: [404, 'Factura no encontrada'] };
    if (user.rol !== 'admin' && f.asesora_id !== user.id) return { error: [403, 'No tienes permiso'] };
    return { f };
  }

  /** Valida y normaliza las líneas que manda el cliente. Devuelve { items } o { error }. */
  async function validarItems(entrada, clienteId) {
    if (!Array.isArray(entrada) || !entrada.length) return { error: 'Agrega al menos una línea' };
    if (entrada.length > 100) return { error: 'Máximo 100 líneas por factura' };
    const items = [];
    for (const [n, l] of entrada.entries()) {
      const descripcion = texto(l?.description, 250);
      const cbm = num(l?.cbm), cajas = l?.boxes === '' || l?.boxes == null ? 0 : Math.trunc(num(l.boxes));
      const peso = l?.weight === '' || l?.weight == null ? 0 : num(l.weight);
      const tarifaMaritima = l?.seaRate === '' || l?.seaRate == null ? TARIFA_MARITIMA : num(l.seaRate);
      const volumenTerrestre = l?.landVolume === '' || l?.landVolume == null ? 0 : num(l.landVolume);
      const tarifaTerrestre = l?.landRate === '' || l?.landRate == null ? 0 : num(l.landRate);
      const extra = l?.extra === '' || l?.extra == null ? 0 : num(l.extra);
      if (!descripcion) return { error: `Línea ${n + 1}: falta la descripción` };
      const campos = { cbm, cajas, peso, tarifaMaritima, volumenTerrestre, tarifaTerrestre, extra };
      if (Object.values(campos).some((v) => !Number.isFinite(v) || v < 0)) return { error: `Línea ${n + 1}: los números deben ser válidos y no negativos` };
      if (cbm === 0 && extra === 0) return { error: `Línea ${n + 1}: indica el CBM o un extra` };
      let etiquetaId = null;
      if (l?.labelId) {
        etiquetaId = intId(l.labelId);
        const e = (await db.query('SELECT id FROM etiquetas WHERE id=$1 AND cliente_id=$2', [etiquetaId, clienteId])).rows[0];
        if (!e) return { error: `Línea ${n + 1}: la etiqueta no pertenece a este cliente` };
      }
      items.push({ etiquetaId, descripcion, cajas, cbm: r3(cbm), peso: r2(peso), tarifaMaritima: r2(tarifaMaritima), volumenTerrestre: r3(volumenTerrestre), tarifaTerrestre: r2(tarifaTerrestre), extra: r2(extra), monto: montoLinea({ cbm: r3(cbm), tarifaMaritima: r2(tarifaMaritima), volumenTerrestre: r3(volumenTerrestre), tarifaTerrestre: r2(tarifaTerrestre), extra: r2(extra) }) });
    }
    return { items };
  }

  /* ----- facturas ----- */

  app.get('/api/facturas', auth, async (req, res) => {
    try {
      const admin = req.user.rol === 'admin';
      const r = await db.query(`${FACTURA_SQL} ${admin ? '' : 'WHERE f.asesora_id=$1'} ORDER BY f.id DESC LIMIT 500`, admin ? [] : [req.user.id]);
      res.json(r.rows.map(facturaOut));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar las facturas' }); }
  });

  /** Etiquetas del cliente todavía sin facturar, con las cifras listas para armar las líneas. */
  app.get('/api/facturas/pendientes/:clienteId', auth, soloAdmin, async (req, res) => {
    try {
      const clienteId = intId(req.params.clienteId);
      const r = await db.query(
        `SELECT e.id,e.numero,e.tipo_mercancia,e.cajas_packing_list,e.cajas_en_china,e.cbm_packing_list,e.cbm_real_china FROM etiquetas e
         WHERE e.cliente_id=$1 AND e.id NOT IN (SELECT fi.etiqueta_id FROM factura_items fi JOIN facturas f ON f.id=fi.factura_id WHERE f.estado<>'anulada' AND fi.etiqueta_id IS NOT NULL)
         ORDER BY e.id`, [clienteId]);
      res.json(r.rows.map((e) => ({
        labelId: `l${e.id}`, number: e.numero, description: e.tipo_mercancia || e.numero,
        boxes: Number(e.cajas_en_china ?? e.cajas_packing_list ?? 0), cbm: Number(e.cbm_real_china ?? e.cbm_packing_list ?? 0), seaRate: TARIFA_MARITIMA,
      })));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar las etiquetas' }); }
  });

  app.get('/api/facturas/:id', auth, async (req, res) => {
    try {
      const { f, error } = await cargarFactura(intId(req.params.id), req.user);
      if (error) return res.status(error[0]).json({ error: error[1] });
      const items = (await db.query('SELECT * FROM factura_items WHERE factura_id=$1 ORDER BY id', [f.id])).rows;
      const pagos = (await db.query("SELECT id,TO_CHAR(fecha,'YYYY-MM-DD') AS fecha,monto,metodo,referencia,fecha_creacion FROM factura_pagos WHERE factura_id=$1 ORDER BY id", [f.id])).rows;
      res.json({ ...facturaOut(f), items: items.map(itemOut), payments: pagos.map(pagoOut) });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo cargar la factura' }); }
  });

  app.post('/api/facturas', auth, soloAdmin, async (req, res) => {
    let tx = null;
    try {
      const b = req.body || {};
      const clienteId = intId(b.clientId);
      const cliente = clienteId ? (await db.query('SELECT id,asesora_id,codigo_cliente,nombre FROM clientes WHERE id=$1', [clienteId])).rows[0] : null;
      if (!cliente) return res.status(400).json({ error: 'Elige un cliente válido' });
      const fechaFactura = fecha(b.date) || new Date().toISOString().slice(0, 10);
      const { items, error } = await validarItems(b.items, clienteId);
      if (error) return res.status(400).json({ error });
      const total = r2(items.reduce((s, i) => s + i.monto, 0));
      const yaFacturadas = items.map((i) => i.etiquetaId).filter(Boolean);
      for (const id of new Set(yaFacturadas)) {
        const dup = (await db.query("SELECT f.codigo FROM factura_items fi JOIN facturas f ON f.id=fi.factura_id WHERE fi.etiqueta_id=$1 AND f.estado<>'anulada'", [id])).rows[0];
        if (dup) return res.status(409).json({ error: `Una etiqueta de este pedido ya está en la factura ${dup.codigo}` });
      }
      const regla = await reglaDe(db, cliente.asesora_id);
      const comision = cliente.asesora_id ? calcularComision(regla, items, total) : null;

      tx = await db.connect();
      await tx.query('BEGIN');
      // Carrera de doble facturación: se bloquean las etiquetas (fila) y se vuelve a comprobar ya dentro de la transacción.
      for (const eid of new Set(yaFacturadas)) await tx.query('UPDATE etiquetas SET fecha_actualizacion=fecha_actualizacion WHERE id=$1', [eid]);
      for (const eid of new Set(yaFacturadas)) {
        const dup = (await tx.query("SELECT f.codigo FROM factura_items fi JOIN facturas f ON f.id=fi.factura_id WHERE fi.etiqueta_id=$1 AND f.estado<>'anulada'", [eid])).rows[0];
        if (dup) { await tx.query('ROLLBACK'); return res.status(409).json({ error: `Una etiqueta de este pedido ya está en la factura ${dup.codigo}` }); }
      }
      const ins = await tx.query(
        `INSERT INTO facturas(cliente_id,asesora_id,fecha_factura,fecha_pedido,fecha_carga,fecha_estimada_llegada,direccion,metodo_envio,metodo_pago,modo_entrega,forma_declarar,otros_servicios,observaciones,total,creado_por)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [clienteId, cliente.asesora_id || null, fechaFactura, fecha(b.orderDate), fecha(b.loadDate), fecha(b.eta), texto(b.address, 250), texto(b.shipping, 100), texto(b.paymentMethod, 100), texto(b.delivery, 100), texto(b.declaration, 100), texto(b.otherServices, 250), texto(b.notes, 2000), total, req.user.id]);
      const id = ins.rows[0].id;
      const codigo = `F-${fechaFactura.slice(0, 4)}-${String(id).padStart(6, '0')}`;
      await tx.query('UPDATE facturas SET codigo=$1 WHERE id=$2', [codigo, id]);
      for (const i of items) {
        await tx.query('INSERT INTO factura_items(factura_id,etiqueta_id,descripcion,cajas,cbm,peso,tarifa_maritima,volumen_terrestre,tarifa_terrestre,extra,monto) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [id, i.etiquetaId, i.descripcion, i.cajas, i.cbm, i.peso, i.tarifaMaritima, i.volumenTerrestre, i.tarifaTerrestre, i.extra, i.monto]);
      }
      if (comision) {
        await tx.query('INSERT INTO comisiones(factura_id,asesora_id,cliente_id,base,regla,tasa,monto) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [id, cliente.asesora_id, clienteId, comision.base, regla.tipo, regla.valor, comision.monto]);
      }
      await tx.query('COMMIT');
      await logAction(req.user.id, `Factura ${codigo} emitida`, 'facturas', id, `Cliente ${cliente.codigo_cliente || cliente.nombre}, total $${total.toFixed(2)}.`);
      res.status(201).json({ id: String(id), codigo, total, commission: comision ? comision.monto : null });
    } catch (e) {
      if (tx) await tx.query('ROLLBACK').catch(() => {});
      console.error(e);
      res.status(500).json({ error: 'No se pudo emitir la factura' });
    } finally {
      if (tx && typeof tx.release === 'function') tx.release();
    }
  });

  app.post('/api/facturas/:id/anular', auth, soloAdmin, async (req, res) => {
    try {
      const { f, error } = await cargarFactura(intId(req.params.id), req.user);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (f.estado === 'anulada') return res.status(409).json({ error: 'La factura ya está anulada' });
      if (Number(f.pagado) > 0) return res.status(409).json({ error: 'La factura tiene pagos registrados; elimínalos antes de anularla' });
      const c = (await db.query('SELECT estado FROM comisiones WHERE factura_id=$1', [f.id])).rows[0];
      if (c && c.estado === 'pagada') return res.status(409).json({ error: 'La comisión de esta factura ya se pagó; no se puede anular' });
      await db.query("UPDATE facturas SET estado='anulada' WHERE id=$1", [f.id]);
      await db.query("UPDATE comisiones SET estado='anulada' WHERE factura_id=$1", [f.id]);
      await logAction(req.user.id, `Factura ${f.codigo} anulada`, 'facturas', f.id, 'Sus etiquetas quedan libres para volver a facturarse.');
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo anular la factura' }); }
  });

  /* ----- pagos ----- */

  async function recalcularPagado(facturaId) {
    const s = (await db.query('SELECT COALESCE(SUM(monto),0) AS t FROM factura_pagos WHERE factura_id=$1', [facturaId])).rows[0];
    await db.query('UPDATE facturas SET pagado=$1 WHERE id=$2', [r2(Number(s.t)), facturaId]);
  }

  app.post('/api/facturas/:id/pagos', auth, soloAdmin, async (req, res) => {
    try {
      const { f, error } = await cargarFactura(intId(req.params.id), req.user);
      if (error) return res.status(error[0]).json({ error: error[1] });
      if (f.estado === 'anulada') return res.status(409).json({ error: 'La factura está anulada' });
      const monto = num(req.body?.amount);
      if (!Number.isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor que cero' });
      const dia = fecha(req.body?.date) || new Date().toISOString().slice(0, 10);
      // Transacción con la factura bloqueada: dos abonos simultáneos no pueden pasarse del saldo.
      const tx = await db.connect();
      try {
        await tx.query('BEGIN');
        await tx.query('UPDATE facturas SET pagado=pagado WHERE id=$1', [f.id]);
        const actual = (await tx.query('SELECT total,COALESCE((SELECT SUM(monto) FROM factura_pagos WHERE factura_id=$1),0) AS abonado FROM facturas WHERE id=$1', [f.id])).rows[0];
        const saldo = r2(Number(actual.total) - Number(actual.abonado));
        if (r2(monto) > saldo + 0.005) { await tx.query('ROLLBACK'); return res.status(400).json({ error: `El abono supera el saldo pendiente ($${saldo.toFixed(2)})` }); }
        await tx.query('INSERT INTO factura_pagos(factura_id,fecha,monto,metodo,referencia,creado_por) VALUES($1,$2,$3,$4,$5,$6)', [f.id, dia, r2(monto), texto(req.body?.method, 100), texto(req.body?.reference, 150), req.user.id]);
        await tx.query('UPDATE facturas SET pagado=$1 WHERE id=$2', [r2(Number(actual.abonado) + r2(monto)), f.id]);
        await tx.query('COMMIT');
      } catch (e) {
        await tx.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        if (typeof tx.release === 'function') tx.release();
      }
      await logAction(req.user.id, `Pago de $${r2(monto).toFixed(2)} a ${f.codigo}`, 'facturas', f.id, texto(req.body?.reference, 150) || '');
      res.status(201).json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo registrar el pago' }); }
  });

  app.delete('/api/facturas/:id/pagos/:pagoId', auth, soloAdmin, async (req, res) => {
    try {
      const { f, error } = await cargarFactura(intId(req.params.id), req.user);
      if (error) return res.status(error[0]).json({ error: error[1] });
      const p = (await db.query('SELECT id,monto FROM factura_pagos WHERE id=$1 AND factura_id=$2', [intId(req.params.pagoId), f.id])).rows[0];
      if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
      await db.query('DELETE FROM factura_pagos WHERE id=$1', [p.id]);
      await recalcularPagado(f.id);
      await logAction(req.user.id, `Pago eliminado de ${f.codigo}`, 'facturas', f.id, `Se quitó un abono de $${Number(p.monto).toFixed(2)}.`);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo eliminar el pago' }); }
  });

  /* ----- PDF ----- */

  app.get('/api/facturas/:id/pdf', auth, async (req, res) => {
    try {
      const { f, error } = await cargarFactura(intId(req.params.id), req.user);
      if (error) return res.status(error[0]).json({ error: error[1] });
      const items = (await db.query('SELECT * FROM factura_items WHERE factura_id=$1 ORDER BY id', [f.id])).rows.map(itemOut);
      const fo = facturaOut(f);
      const doc = new PDFKit({ size: 'A4', margin: 40 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fo.codigo.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`);
      doc.pipe(res);
      const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      doc.font('Helvetica-Bold').fontSize(20).text('CRIOLLO CARGO', { continued: false });
      doc.font('Helvetica').fontSize(10).fillColor('#5a5b54').text('Factura de servicios');
      doc.fillColor('#111210').font('Helvetica-Bold').fontSize(14).text(fo.codigo, 400, 40, { width: 155, align: 'right' });
      if (fo.status === 'anulada') doc.fillColor('#b4492b').fontSize(12).text('ANULADA', 400, 60, { width: 155, align: 'right' });
      doc.fillColor('#111210').font('Helvetica').fontSize(10);

      let y = 100;
      const dato = (k, v, x) => { doc.font('Helvetica-Bold').text(`${k}: `, x, y, { continued: true }).font('Helvetica').text(v || '—', { width: 240 }); };
      dato('Fecha de facturación', fo.date, 40); dato('Código de factura', fo.codigo, 310); y += 16;
      dato('Cliente', fo.clientName, 40); dato('Código de cliente', fo.clientCode, 310); y += 16;
      dato('Código de vendedor', fo.advisorCode, 40); dato('Teléfono', fo.clientPhone, 310); y += 16;
      dato('Fecha del pedido', fo.orderDate, 40); dato('Fecha de la carga', fo.loadDate, 310); y += 16;
      dato('Llegada estimada', fo.eta, 40); dato('Dirección', fo.address, 310); y += 16;
      dato('Método de envío', fo.shipping, 40); dato('Método de pago', fo.paymentMethod, 310); y += 16;
      dato('Modo de entrega', fo.delivery, 40); dato('Forma de declarar', fo.declaration, 310); y += 16;
      if (fo.otherServices) { dato('Otros servicios', fo.otherServices, 40); y += 16; }

      y += 10;
      const cols = [[40, 24, '№'], [64, 150, 'Descripción'], [214, 40, 'Cajas'], [254, 55, 'CBM'], [309, 50, 'Peso kg'], [359, 62, '$/CBM'], [421, 62, 'Terrestre'], [483, 72, 'Monto']];
      doc.rect(40, y, 515, 18).fill('#111210');
      doc.fillColor('#ece8de').font('Helvetica-Bold').fontSize(8.5);
      cols.forEach(([x, w, t]) => doc.text(t, x + 3, y + 5, { width: w - 6 }));
      y += 18;
      doc.fillColor('#111210').font('Helvetica').fontSize(9);
      items.forEach((i, n) => {
        if (y > 740) { doc.addPage(); y = 40; }
        const terrestre = i.landVolume * i.landRate + i.extra;
        const fila = [String(n + 1), i.description, String(i.boxes), i.cbm.toFixed(3), i.weight ? i.weight.toFixed(2) : '—', usd(i.seaRate), terrestre ? usd(terrestre) : '—', usd(i.amount)];
        cols.forEach(([x, w], k) => doc.text(fila[k], x + 3, y + 4, { width: w - 6, ellipsis: true, lineBreak: false }));
        y += 18;
        doc.moveTo(40, y).lineTo(555, y).strokeColor('#c9c4b5').lineWidth(0.5).stroke();
      });
      y += 12;
      doc.font('Helvetica-Bold').fontSize(12).text(`TOTAL: ${usd(fo.total)}`, 40, y, { width: 515, align: 'right' });
      y += 18;
      doc.font('Helvetica').fontSize(10).text(`Pagado: ${usd(fo.paid)}   ·   Saldo: ${usd(fo.balance)}`, 40, y, { width: 515, align: 'right' });
      if (fo.notes) { y += 28; doc.font('Helvetica-Bold').text('Observaciones', 40, y); doc.font('Helvetica').text(fo.notes, 40, y + 14, { width: 515 }); }
      doc.fontSize(8).fillColor('#7d7e75').text('Tarifas referenciales; los valores pueden variar según mercancía, modalidad, volumen y destino.', 40, 790, { width: 515, align: 'center' });
      doc.end();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el PDF' });
    }
  });

  /* ----- comisiones ----- */

  const COMISION_SQL = `SELECT m.id,m.factura_id,m.asesora_id,m.cliente_id,m.base,m.regla,m.tasa,m.monto,m.estado,TO_CHAR(m.fecha_pago,'YYYY-MM-DD') AS fecha_pago,
      f.codigo AS factura_codigo,TO_CHAR(f.fecha_factura,'YYYY-MM-DD') AS fecha_factura,f.total AS factura_total,f.estado AS factura_estado,
      u.nombre AS asesora_nombre,c.nombre AS cliente_nombre,c.apellido AS cliente_apellido,c.codigo_cliente
    FROM comisiones m JOIN facturas f ON f.id=m.factura_id LEFT JOIN usuarios u ON u.id=m.asesora_id LEFT JOIN clientes c ON c.id=m.cliente_id`;

  app.get('/api/comisiones', auth, async (req, res) => {
    try {
      const admin = req.user.rol === 'admin';
      const asesora = admin ? intId(req.query.asesora) : req.user.id; // el asesor solo ve las suyas, aunque pida otra
      const filtros = [], params = [];
      if (asesora) { params.push(asesora); filtros.push(`m.asesora_id=$${params.length}`); }
      if (['pendiente', 'pagada', 'anulada'].includes(req.query.estado)) { params.push(req.query.estado); filtros.push(`m.estado=$${params.length}`); }
      const rows = (await db.query(`${COMISION_SQL} ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''} ORDER BY m.id DESC LIMIT 1000`, params)).rows.map(comisionOut);
      const vigentes = rows.filter((c) => c.status !== 'anulada');
      const suma = (arr) => r2(arr.reduce((s, c) => s + c.amount, 0));
      const porCliente = new Map();
      for (const c of vigentes) {
        const k = c.clientId || 'sin';
        const a = porCliente.get(k) || { clientId: c.clientId, clientCode: c.clientCode, clientName: c.clientName, invoices: 0, billed: 0, generated: 0, pending: 0, paid: 0 };
        a.invoices++; a.billed = r2(a.billed + c.invoiceTotal); a.generated = r2(a.generated + c.amount);
        if (c.status === 'pagada') a.paid = r2(a.paid + c.amount); else a.pending = r2(a.pending + c.amount);
        porCliente.set(k, a);
      }
      const porAsesor = new Map();
      if (admin) {
        for (const c of vigentes) {
          const a = porAsesor.get(c.advisorId) || { advisorId: c.advisorId, advisorName: c.advisorName || 'Sin asesor', generated: 0, pending: 0, paid: 0 };
          a.generated = r2(a.generated + c.amount);
          if (c.status === 'pagada') a.paid = r2(a.paid + c.amount); else a.pending = r2(a.pending + c.amount);
          porAsesor.set(c.advisorId, a);
        }
      }
      res.json({
        items: rows,
        totals: { generated: suma(vigentes), pending: suma(vigentes.filter((c) => c.status === 'pendiente')), paid: suma(vigentes.filter((c) => c.status === 'pagada')) },
        byClient: [...porCliente.values()].sort((a, b) => b.generated - a.generated),
        byAdvisor: [...porAsesor.values()].sort((a, b) => b.generated - a.generated),
        rule: admin ? null : await reglaDe(db, req.user.id),
        rules: REGLAS,
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar las comisiones' }); }
  });

  app.get('/api/comisiones/reglas', auth, soloAdmin, async (req, res) => {
    try {
      const r = (await db.query('SELECT asesora_id,tipo,valor FROM comision_reglas')).rows;
      const global = r.find((x) => x.asesora_id == null);
      res.json({
        types: REGLAS,
        global: global ? { type: global.tipo, value: Number(global.valor) } : { type: REGLA_POR_DEFECTO.tipo, value: REGLA_POR_DEFECTO.valor, unset: true },
        advisors: r.filter((x) => x.asesora_id != null).map((x) => ({ advisorId: `u${x.asesora_id}`, type: x.tipo, value: Number(x.valor) })),
      });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron cargar las reglas' }); }
  });

  app.put('/api/comisiones/reglas', auth, soloAdmin, async (req, res) => {
    try {
      const b = req.body || {};
      const tipo = String(b.type || '');
      const valor = num(b.value);
      if (!REGLAS[tipo]) return res.status(400).json({ error: 'Tipo de regla no válido' });
      if (!Number.isFinite(valor) || valor < 0 || (tipo !== 'fijo_cbm' && valor > 100)) return res.status(400).json({ error: tipo === 'fijo_cbm' ? 'El monto por CBM debe ser un número no negativo' : 'El porcentaje debe estar entre 0 y 100' });
      const asesoraId = b.advisorId ? intId(b.advisorId) : null;
      if (asesoraId && !(await db.query("SELECT 1 AS x FROM usuarios WHERE id=$1 AND rol='asesora'", [asesoraId])).rows.length) return res.status(400).json({ error: 'Asesor no válido' });
      if (asesoraId) {
        await db.query('DELETE FROM comision_reglas WHERE asesora_id=$1', [asesoraId]);
        await db.query('INSERT INTO comision_reglas(asesora_id,tipo,valor) VALUES($1,$2,$3)', [asesoraId, tipo, valor]);
      } else {
        await db.query('DELETE FROM comision_reglas WHERE asesora_id IS NULL');
        await db.query('INSERT INTO comision_reglas(asesora_id,tipo,valor) VALUES(NULL,$1,$2)', [tipo, valor]);
      }
      await logAction(req.user.id, 'Regla de comisión actualizada', 'comision_reglas', asesoraId || 0, `${asesoraId ? `Asesor u${asesoraId}` : 'Global'}: ${REGLAS[tipo]} = ${valor}.`);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo guardar la regla' }); }
  });

  /** Quita la regla propia de un asesor (vuelve a aplicarle la global). */
  app.delete('/api/comisiones/reglas/:asesoraId', auth, soloAdmin, async (req, res) => {
    try {
      await db.query('DELETE FROM comision_reglas WHERE asesora_id=$1', [intId(req.params.asesoraId)]);
      res.json({ ok: true });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo quitar la regla' }); }
  });

  /** Vuelve a calcular las comisiones PENDIENTES con la regla vigente. Las pagadas no se tocan nunca. */
  app.post('/api/comisiones/recalcular', auth, soloAdmin, async (req, res) => {
    try {
      const pend = (await db.query(`SELECT m.id,m.factura_id,m.asesora_id,f.total FROM comisiones m JOIN facturas f ON f.id=m.factura_id WHERE m.estado='pendiente' AND f.estado='emitida'`)).rows;
      let cambiadas = 0;
      for (const m of pend) {
        const items = (await db.query('SELECT cbm,tarifa_maritima FROM factura_items WHERE factura_id=$1', [m.factura_id])).rows.map((i) => ({ cbm: Number(i.cbm), tarifaMaritima: Number(i.tarifa_maritima) }));
        const regla = await reglaDe(db, m.asesora_id);
        const c = calcularComision(regla, items, Number(m.total));
        await db.query('UPDATE comisiones SET base=$1,regla=$2,tasa=$3,monto=$4 WHERE id=$5', [c.base, regla.tipo, regla.valor, c.monto, m.id]);
        cambiadas++;
      }
      await logAction(req.user.id, 'Comisiones pendientes recalculadas', 'comisiones', 0, `${cambiadas} comisión(es).`);
      res.json({ ok: true, recalculated: cambiadas });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron recalcular las comisiones' }); }
  });

  app.post('/api/comisiones/pagar', auth, soloAdmin, async (req, res) => {
    try {
      const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(intId).filter(Number.isInteger).slice(0, 500);
      if (!ids.length) return res.status(400).json({ error: 'Elige al menos una comisión' });
      const dia = fecha(req.body?.date) || new Date().toISOString().slice(0, 10);
      const r = await db.query("UPDATE comisiones SET estado='pagada',fecha_pago=$1,pagado_por=$2 WHERE estado='pendiente' AND id = ANY($3::int[])", [dia, req.user.id, ids]);
      await logAction(req.user.id, 'Comisiones pagadas', 'comisiones', 0, `${r.rowCount} comisión(es) marcadas como pagadas el ${dia}.`);
      res.json({ ok: true, paid: r.rowCount });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron marcar las comisiones' }); }
  });
}

module.exports = { ensureSchema, registrar, calcularComision, montoLinea, REGLAS, TARIFA_MARITIMA };
