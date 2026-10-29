/**
 * Facturación, comisiones, importación de datos y acceso a la app móvil del cliente.
 * Se carga DESPUÉS de app.js y se engancha a él: añade entradas al menú, nuevas vistas y secciones en los modales de
 * cliente y de etiqueta. Usa las funciones de app.js (api, me, openModal, closeModal, toast, esc, field, selectField…).
 */
(function () {
  'use strict';

  const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const isAdmin = () => me()?.role === 'admin';
  const page = () => document.getElementById('page');
  const $ = (id) => document.getElementById(id);
  const aviso = (m) => toast(m);
  const fecha = (d) => (typeof fmtDate === 'function' ? fmtDate(d) : d || '—');

  const ESTADO_PAGO = { pendiente: 'Pendiente', parcial: 'Parcial', pagada: 'Pagada', anulada: 'Anulada' };
  const pillPago = (s) => `<span class="fx-pill ${esc(s)}">${esc(ESTADO_PAGO[s] || s)}</span>`;
  const ESTADO_COM = { pendiente: ['Pendiente', 'pendiente'], pagada: ['Pagada', 'pagada'], anulada: ['Anulada', 'anulada'] };
  const pillCom = (s) => `<span class="fx-pill ${ESTADO_COM[s]?.[1] || ''}">${esc(ESTADO_COM[s]?.[0] || s)}</span>`;

  const cargando = (titulo) => `<div class="page-head"><div><h1>${esc(titulo)}</h1><p>Cargando…</p></div></div>`;
  const fallo = (titulo, e) => `<div class="page-head"><div><h1>${esc(titulo)}</h1></div></div><div class="card section"><div class="empty">${esc(e?.message || 'No se pudo cargar')}</div></div>`;

  /** Pide un archivo con la sesión (PDF, fotos) y lo devuelve como Blob. */
  async function pedirArchivo(ruta) {
    const r = await fetch(ruta, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
    return r.blob();
  }

  async function descargarPdf(id, codigo) {
    try {
      const url = URL.createObjectURL(await pedirArchivo(`/api/facturas/${encodeURIComponent(id)}/pdf`));
      const a = document.createElement('a');
      a.href = url; a.download = `${codigo || 'factura'}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { aviso(e.message); }
  }

  /* =====================================================================================================
     Menú y enrutado de vistas
     ===================================================================================================== */

  const VISTAS = { billing: mostrarFacturacion, commissions: mostrarComisiones, import: mostrarImportacion };

  const shellOriginal = window.shellHTML;
  window.shellHTML = function () {
    const html = shellOriginal();
    const btn = (v, t) => `<button data-view="${v}" title="${t}"><span class="nav-label">${t}</span></button>`;
    const items = [btn('billing', 'Facturación'), btn('commissions', 'Comisiones'), isAdmin() ? btn('import', 'Importar datos') : ''].join('');
    return html.replace('</nav>', `<div class="nav-group"><div class="nav-divider"><span class="nav-label">Finanzas</span></div>${items}</div></nav>`);
  };

  const renderOriginal = window.renderView;
  window.renderView = function () {
    const vista = VISTAS[currentView];
    if (!vista) return renderOriginal();
    if (currentView === 'import' && !isAdmin()) { currentView = 'dashboard'; return renderOriginal(); }
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
    if (page()) vista();
  };

  const alCambiar = (vista) => currentView === vista && page();

  /* =====================================================================================================
     Facturación
     ===================================================================================================== */

  let facturas = [];
  let filtroTexto = '';
  let filtroEstado = '';

  async function mostrarFacturacion() {
    page().innerHTML = cargando('Facturación');
    try { facturas = await api('/api/facturas'); } catch (e) { if (alCambiar('billing')) page().innerHTML = fallo('Facturación', e); return; }
    if (!alCambiar('billing')) return;
    const vigentes = facturas.filter((f) => f.status !== 'anulada');
    const sum = (k) => r2(vigentes.reduce((s, f) => s + f[k], 0));
    page().innerHTML = `
      <div class="page-head"><div><h1>Facturación</h1><p>${isAdmin() ? 'Facturas de servicios de flete, pagos y saldos por cliente.' : 'Facturas de tus clientes (solo lectura).'}</p></div>
        <div class="row">${isAdmin() ? '<button class="btn btn-primary" id="fxNueva">Nueva factura</button>' : ''}</div></div>
      <div class="fx-kpis">
        <div class="fx-kpi"><span>Facturado</span><b>${usd(sum('total'))}</b><small>${vigentes.length} factura(s) vigentes</small></div>
        <div class="fx-kpi"><span>Cobrado</span><b>${usd(sum('paid'))}</b></div>
        <div class="fx-kpi"><span>Por cobrar</span><b>${usd(r2(sum('total') - sum('paid')))}</b></div>
      </div>
      <div class="fx-toolbar">
        <input type="search" id="fxBuscar" placeholder="Buscar por código, cliente o asesor" value="${esc(filtroTexto)}" aria-label="Buscar facturas">
        <select id="fxEstado" aria-label="Estado de pago"><option value="">Todos los estados</option>${Object.entries(ESTADO_PAGO).map(([k, v]) => `<option value="${k}" ${filtroEstado === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Asesor</th><th class="fx-num">Total</th><th class="fx-num">Pagado</th><th class="fx-num">Saldo</th><th>Estado</th><th></th></tr></thead><tbody id="fxFilas"></tbody></table></div></div>`;
    pintarFacturas();
    $('fxBuscar').oninput = (e) => { filtroTexto = e.target.value; pintarFacturas(); };
    $('fxEstado').onchange = (e) => { filtroEstado = e.target.value; pintarFacturas(); };
    $('fxNueva')?.addEventListener('click', () => facturaModal());
  }

  function pintarFacturas() {
    const q = filtroTexto.trim().toLowerCase();
    const filas = facturas.filter((f) => (!filtroEstado || f.paymentStatus === filtroEstado) && (!q || [f.codigo, f.clientName, f.clientCode, f.advisorName].join(' ').toLowerCase().includes(q)));
    $('fxFilas').innerHTML = filas.length
      ? filas.map((f) => `<tr><td><span class="code-pill">${esc(f.codigo)}</span></td><td>${esc(fecha(f.date))}</td>
          <td><b>${esc(f.clientName)}</b><br><small class="fx-muted">${esc(f.clientCode)}</small></td><td>${esc(f.advisorName || '—')}</td>
          <td class="fx-num">${usd(f.total)}</td><td class="fx-num">${usd(f.paid)}</td><td class="fx-num">${f.status === 'anulada' ? '—' : usd(f.balance)}</td>
          <td>${pillPago(f.paymentStatus)}</td>
          <td><div class="fx-table-actions"><button class="btn btn-secondary btn-sm" data-fx-ver="${esc(f.id)}">Ver</button><button class="btn btn-secondary btn-sm" data-fx-pdf="${esc(f.id)}" data-cod="${esc(f.codigo)}">PDF</button></div></td></tr>`).join('')
      : `<tr><td colspan="9"><div class="empty compact">${facturas.length ? 'Ninguna factura coincide con el filtro.' : 'Todavía no hay facturas.'}</div></td></tr>`;
    document.querySelectorAll('[data-fx-ver]').forEach((b) => (b.onclick = () => facturaDetalle(b.dataset.fxVer)));
    document.querySelectorAll('[data-fx-pdf]').forEach((b) => (b.onclick = () => descargarPdf(b.dataset.fxPdf, b.dataset.cod)));
  }

  /* ---------- Nueva factura ---------- */

  function facturaModal() {
    if (!isAdmin()) return;
    let lineas = [];
    let pendientes = [];
    const clientes = [...db.clients].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const opcionesCliente = (q = '') => {
      const t = q.trim().toLowerCase();
      const lista = clientes.filter((c) => !t || `${c.code} ${c.name} ${c.company || ''}`.toLowerCase().includes(t));
      return `<option value="">Selecciona un cliente</option>` + lista.slice(0, 300).map((c) => `<option value="${esc(c.id)}">${esc(c.code || '—')} · ${esc(c.name)}</option>`).join('');
    };

    openModal('Nueva factura de servicios', `
      <div class="fx-box"><h3>1. Cliente</h3>
        <div class="fx-grid">
          <div class="field"><label>Buscar cliente</label><input id="fxCliBuscar" type="search" placeholder="Código, nombre o empresa"></div>
          <div class="field"><label>Cliente</label><select id="fxCliente">${opcionesCliente()}</select></div>
          ${field('fxFecha', 'Fecha de facturación', hoy(), 'date')}
        </div>
      </div>
      <div class="fx-box"><h3>2. Datos del envío</h3>
        <div class="fx-grid">
          ${field('fxPedido', 'Fecha del pedido', '', 'date')}${field('fxCarga', 'Fecha de la carga', '', 'date')}${field('fxEta', 'Llegada estimada', '', 'date')}
          ${field('fxDireccion', 'Dirección / destino', '', 'text', 'maxlength="250"')}${field('fxEnvio', 'Método de envío', 'Marítimo', 'text', 'maxlength="100"')}${field('fxPago', 'Método de pago', '', 'text', 'maxlength="100"')}
          ${field('fxEntrega', 'Modo de entrega', '', 'text', 'maxlength="100"')}${field('fxDeclara', 'Forma de declarar', '', 'text', 'maxlength="100"')}${field('fxOtros', 'Otros servicios', '', 'text', 'maxlength="250"')}
        </div>
      </div>
      <div class="fx-box"><h3>3. Mercancía</h3>
        <div id="fxPendientes" class="fx-muted">Elige un cliente para ver sus etiquetas sin facturar.</div>
        <div class="fx-scroll"><table class="fx-lines"><thead><tr><th>Descripción</th><th>Cajas</th><th>CBM</th><th>Peso kg</th><th>$/CBM</th><th>Vol. terrestre</th><th>$/CBM terr.</th><th>Extra $</th><th class="fx-num">Monto</th><th></th></tr></thead><tbody id="fxLineas"></tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="fxAgregar" type="button">+ Línea manual</button></div>
        <div class="fx-total"><span>Total</span><b id="fxTotal">$0.00</b></div>
      </div>
      <div class="field"><label>Observaciones</label><input id="fxNotas" maxlength="2000"></div>
      <small class="fx-muted">La comisión del asesor se calcula al emitir, con la regla vigente (sección Comisiones).</small>`,
      '<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="fxEmitir">Emitir factura</button>');
    $('modalCancel').onclick = closeModal;

    const monto = (l) => r2(num(l.cbm) * num(l.seaRate) + num(l.landVolume) * num(l.landRate) + num(l.extra));
    const total = () => r2(lineas.reduce((s, l) => s + monto(l), 0));

    function pintarLineas() {
      $('fxLineas').innerHTML = lineas.map((l, i) => {
        const inp = (k, cls = '', tipo = 'number') => `<td><input class="${cls}" data-i="${i}" data-k="${k}" type="${tipo}" ${tipo === 'number' ? 'min="0" step="any"' : 'maxlength="250"'} value="${esc(l[k] ?? '')}"></td>`;
        return `<tr>${inp('description', 'fx-desc', 'text')}${inp('boxes')}${inp('cbm')}${inp('weight')}${inp('seaRate')}${inp('landVolume')}${inp('landRate')}${inp('extra')}<td class="fx-monto" id="fxM${i}">${usd(monto(l))}</td><td><button class="btn btn-secondary btn-sm" data-quitar="${i}" type="button" aria-label="Quitar línea">×</button></td></tr>`;
      }).join('') || '<tr><td colspan="10"><div class="empty compact">Agrega etiquetas pendientes o una línea manual.</div></td></tr>';
      $('fxTotal').textContent = usd(total());
      document.querySelectorAll('#fxLineas input').forEach((el) => (el.oninput = () => {
        lineas[+el.dataset.i][el.dataset.k] = el.value;
        const m = $(`fxM${el.dataset.i}`); if (m) m.textContent = usd(monto(lineas[+el.dataset.i]));
        $('fxTotal').textContent = usd(total());
      }));
      document.querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = () => { lineas.splice(+b.dataset.quitar, 1); pintarLineas(); pintarPendientes(); }));
    }

    function pintarPendientes() {
      const usadas = new Set(lineas.map((l) => l.labelId).filter(Boolean));
      $('fxPendientes').innerHTML = pendientes.length
        ? `<div class="fx-muted">Etiquetas sin facturar (toca para agregar):</div><div class="fx-chips">${pendientes.map((p) => `<button type="button" class="fx-chip" data-add="${esc(p.labelId)}" ${usadas.has(p.labelId) ? 'disabled' : ''}>${esc(p.number)} · ${esc(p.description)} · ${p.cbm} CBM</button>`).join('')}</div>`
        : 'Este cliente no tiene etiquetas pendientes de facturar.';
      document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
        const p = pendientes.find((x) => x.labelId === b.dataset.add);
        if (p) lineas.push({ labelId: p.labelId, description: p.description, boxes: p.boxes, cbm: p.cbm, weight: '', seaRate: p.seaRate, landVolume: '', landRate: '', extra: '' });
        pintarLineas(); pintarPendientes();
      }));
    }

    $('fxCliBuscar').oninput = (e) => { $('fxCliente').innerHTML = opcionesCliente(e.target.value); };
    $('fxCliente').onchange = async (e) => {
      lineas = []; pendientes = []; pintarLineas();
      const c = clientes.find((x) => x.id === e.target.value);
      if (c && !$('fxDireccion').value) $('fxDireccion').value = c.state || '';
      if (!e.target.value) { $('fxPendientes').textContent = 'Elige un cliente para ver sus etiquetas sin facturar.'; return; }
      try { pendientes = await api(`/api/facturas/pendientes/${encodeURIComponent(e.target.value)}`); } catch (err) { aviso(err.message); }
      pintarPendientes();
    };
    $('fxAgregar').onclick = () => { lineas.push({ labelId: '', description: '', boxes: '', cbm: '', weight: '', seaRate: 660, landVolume: '', landRate: '', extra: '' }); pintarLineas(); };

    $('fxEmitir').onclick = async () => {
      const clientId = $('fxCliente').value;
      if (!clientId) return aviso('Elige un cliente');
      if (!lineas.length) return aviso('Agrega al menos una línea');
      const btn = $('fxEmitir'); btn.disabled = true;
      try {
        const r = await api('/api/facturas', { method: 'POST', body: JSON.stringify({
          clientId, date: $('fxFecha').value, orderDate: $('fxPedido').value, loadDate: $('fxCarga').value, eta: $('fxEta').value,
          address: $('fxDireccion').value, shipping: $('fxEnvio').value, paymentMethod: $('fxPago').value, delivery: $('fxEntrega').value,
          declaration: $('fxDeclara').value, otherServices: $('fxOtros').value, notes: $('fxNotas').value, items: lineas,
        }) });
        closeModal();
        aviso(`Factura ${r.codigo} emitida por ${usd(r.total)}${r.commission != null ? ` · comisión ${usd(r.commission)}` : ''}`);
        if (currentView === 'billing') mostrarFacturacion();
      } catch (e) { aviso(e.message); btn.disabled = false; }
    };
    pintarLineas();
  }

  /* ---------- Detalle de factura ---------- */

  async function facturaDetalle(id) {
    let f;
    try { f = await api(`/api/facturas/${encodeURIComponent(id)}`); } catch (e) { return aviso(e.message); }
    const admin = isAdmin();
    const puedePagar = admin && f.status !== 'anulada' && f.balance > 0.005;
    openModal(`Factura ${esc(f.codigo)}`, `
      <div class="fx-box">
        <div class="fx-grid">
          <div><b>Cliente</b><br>${esc(f.clientName)} <span class="code-pill">${esc(f.clientCode)}</span></div>
          <div><b>Asesor</b><br>${esc(f.advisorName || '—')} ${f.advisorCode ? `<span class="code-pill">${esc(f.advisorCode)}</span>` : ''}</div>
          <div><b>Fecha</b><br>${esc(fecha(f.date))}</div>
          <div><b>Estado</b><br>${pillPago(f.paymentStatus)}</div>
          <div><b>Pedido / carga</b><br>${esc(fecha(f.orderDate))} / ${esc(fecha(f.loadDate))}</div>
          <div><b>Llegada estimada</b><br>${esc(fecha(f.eta))}</div>
          <div><b>Envío</b><br>${esc(f.shipping || '—')} · ${esc(f.address || '—')}</div>
          <div><b>Pago / entrega</b><br>${esc(f.paymentMethod || '—')} · ${esc(f.delivery || '—')}</div>
        </div>
        ${f.notes ? `<p class="fx-muted" style="margin:8px 0 0">${esc(f.notes)}</p>` : ''}
      </div>
      <div class="fx-scroll"><table class="table"><thead><tr><th>Descripción</th><th class="fx-num">Cajas</th><th class="fx-num">CBM</th><th class="fx-num">$/CBM</th><th class="fx-num">Terrestre</th><th class="fx-num">Extra</th><th class="fx-num">Monto</th></tr></thead><tbody>
        ${f.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="fx-num">${i.boxes}</td><td class="fx-num">${i.cbm.toFixed(3)}</td><td class="fx-num">${usd(i.seaRate)}</td><td class="fx-num">${i.landVolume ? `${i.landVolume} × ${usd(i.landRate)}` : '—'}</td><td class="fx-num">${i.extra ? usd(i.extra) : '—'}</td><td class="fx-num"><b>${usd(i.amount)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <div class="fx-total"><span>Total</span><b>${usd(f.total)}</b></div>
      <div class="fx-total" style="font-size:16px"><span>Pagado ${usd(f.paid)} · Saldo</span><b style="font-size:24px">${usd(f.balance)}</b></div>
      <div class="fx-box" style="margin-top:12px"><h3>Pagos</h3>
        ${f.payments.length ? f.payments.map((p) => `<div class="fx-rule-row"><span>${esc(fecha(p.date))} · <b>${usd(p.amount)}</b> ${p.method ? '· ' + esc(p.method) : ''} ${p.reference ? '· ' + esc(p.reference) : ''}</span>${admin && f.status !== 'anulada' ? `<button class="btn btn-secondary btn-sm" data-borrar-pago="${esc(p.id)}">Eliminar</button>` : ''}</div>`).join('') : '<span class="fx-muted">Sin pagos registrados.</span>'}
        ${puedePagar ? `<div class="fx-grid" style="margin-top:10px">${field('fxPMonto', 'Monto del abono', f.balance, 'number', 'min="0" step="0.01"')}${field('fxPFecha', 'Fecha', hoy(), 'date')}${field('fxPMetodo', 'Método', '', 'text', 'maxlength="100" placeholder="Zelle, transferencia…"')}${field('fxPRef', 'Referencia', '', 'text', 'maxlength="150"')}</div><div class="row" style="margin-top:8px"><button class="btn btn-primary btn-sm" id="fxPagar">Registrar abono</button></div>` : ''}
      </div>`,
      `<button class="btn btn-secondary" id="modalCancel">Cerrar</button><button class="btn btn-secondary" id="fxPdf">Descargar PDF</button>${admin && f.status !== 'anulada' ? '<button class="btn btn-secondary" id="fxAnular">Anular factura</button>' : ''}`);
    $('modalCancel').onclick = closeModal;
    $('fxPdf').onclick = () => descargarPdf(f.id, f.codigo);
    $('fxPagar')?.addEventListener('click', async () => {
      try {
        await api(`/api/facturas/${encodeURIComponent(f.id)}/pagos`, { method: 'POST', body: JSON.stringify({ amount: $('fxPMonto').value, date: $('fxPFecha').value, method: $('fxPMetodo').value, reference: $('fxPRef').value }) });
        aviso('Abono registrado');
        facturaDetalle(f.id);
        if (currentView === 'billing') mostrarFacturacion();
      } catch (e) { aviso(e.message); }
    });
    document.querySelectorAll('[data-borrar-pago]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Eliminar este abono? El saldo de la factura se recalcula.')) return;
      try { await api(`/api/facturas/${encodeURIComponent(f.id)}/pagos/${encodeURIComponent(b.dataset.borrarPago)}`, { method: 'DELETE' }); facturaDetalle(f.id); if (currentView === 'billing') mostrarFacturacion(); } catch (e) { aviso(e.message); }
    }));
    $('fxAnular')?.addEventListener('click', async () => {
      if (!confirm(`¿Anular la factura ${f.codigo}? Sus etiquetas quedarán libres para volver a facturarse y su comisión se anula.`)) return;
      try { await api(`/api/facturas/${encodeURIComponent(f.id)}/anular`, { method: 'POST' }); closeModal(); aviso('Factura anulada'); if (currentView === 'billing') mostrarFacturacion(); } catch (e) { aviso(e.message); }
    });
  }

  /* =====================================================================================================
     Comisiones
     ===================================================================================================== */

  let comFiltroAsesor = '';
  let comFiltroEstado = '';

  async function mostrarComisiones() {
    page().innerHTML = cargando('Comisiones');
    const admin = isAdmin();
    let datos, reglas = null;
    try {
      const q = new URLSearchParams();
      if (admin && comFiltroAsesor) q.set('asesora', comFiltroAsesor);
      if (comFiltroEstado) q.set('estado', comFiltroEstado);
      [datos, reglas] = await Promise.all([api(`/api/comisiones${q.toString() ? '?' + q : ''}`), admin ? api('/api/comisiones/reglas') : null]);
    } catch (e) { if (alCambiar('commissions')) page().innerHTML = fallo('Comisiones', e); return; }
    if (!alCambiar('commissions')) return;

    const t = datos.totals;
    const textoRegla = (tipo, valor) => (tipo === 'fijo_cbm' ? `${usd(valor)} por CBM` : `${valor} % ${tipo === 'porcentaje_flete' ? 'del flete marítimo' : 'del total de la factura'}`);
    const asesoras = db.users.filter((u) => u.role === 'asesora' && u.active);

    const kpis = `<div class="fx-kpis">
      <div class="fx-kpi"><span>Generadas</span><b>${usd(t.generated)}</b></div>
      <div class="fx-kpi"><span>Pendientes de pago</span><b>${usd(t.pending)}</b></div>
      <div class="fx-kpi"><span>Pagadas</span><b>${usd(t.paid)}</b></div></div>`;

    const reglaAsesor = !admin && datos.rule ? `<div class="fx-box"><h3>Tu regla de comisión</h3><p style="margin:0">${datos.rule.valor > 0 ? esc(textoRegla(datos.rule.tipo, datos.rule.valor)) : 'Todavía no tienes una comisión definida; la define el administrador.'}</p></div>` : '';

    const porCliente = `<div class="card section"><h3 style="margin-top:0">${admin ? 'Por cliente' : 'Mis comisiones por cliente'}</h3><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Cliente</th><th class="fx-num">Facturas</th><th class="fx-num">Facturado</th><th class="fx-num">Comisión generada</th><th class="fx-num">Pendiente</th><th class="fx-num">Pagada</th></tr></thead><tbody>
      ${datos.byClient.length ? datos.byClient.map((c) => `<tr><td><span class="code-pill">${esc(c.clientCode || '—')}</span> <b>${esc(c.clientName || 'Sin cliente')}</b></td><td class="fx-num">${c.invoices}</td><td class="fx-num">${usd(c.billed)}</td><td class="fx-num"><b>${usd(c.generated)}</b></td><td class="fx-num">${usd(c.pending)}</td><td class="fx-num">${usd(c.paid)}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty compact">Aún no hay comisiones generadas.</div></td></tr>'}
    </tbody></table></div></div>`;

    const porAsesor = admin ? `<div class="card section"><h3 style="margin-top:0">Por asesor</h3><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Asesor</th><th class="fx-num">Generada</th><th class="fx-num">Pendiente</th><th class="fx-num">Pagada</th></tr></thead><tbody>
      ${datos.byAdvisor.length ? datos.byAdvisor.map((a) => `<tr><td><b>${esc(a.advisorName)}</b></td><td class="fx-num">${usd(a.generated)}</td><td class="fx-num">${usd(a.pending)}</td><td class="fx-num">${usd(a.paid)}</td></tr>`).join('') : '<tr><td colspan="4"><div class="empty compact">Sin datos todavía.</div></td></tr>'}
    </tbody></table></div></div>` : '';

    const reglasHtml = admin ? (() => {
      const propias = new Map(reglas.advisors.map((r) => [r.advisorId, r]));
      return `<div class="fx-box"><h3>Reglas de comisión</h3>
        <p class="fx-muted" style="margin:0 0 8px">${reglas.global.unset ? '<span class="fx-warn"><b>Sin definir:</b> hasta que configures una regla, las comisiones se generan en $0.00.</span> ' : ''}La regla global se aplica a los asesores que no tengan una propia. Se aplica al emitir cada factura.</p>
        <div class="fx-rule-row"><span><b>Global:</b> ${esc(textoRegla(reglas.global.type, reglas.global.value))}</span><button class="btn btn-secondary btn-sm" data-regla="">Cambiar</button></div>
        ${asesoras.map((u) => { const r = propias.get(u.id); return `<div class="fx-rule-row"><span>${esc(u.name)}${u.advisorCode ? ` <span class="code-pill">${esc(u.advisorCode)}</span>` : ''}: ${r ? esc(textoRegla(r.type, r.value)) : '<span class="fx-muted">usa la global</span>'}</span><button class="btn btn-secondary btn-sm" data-regla="${esc(u.id)}">${r ? 'Cambiar' : 'Regla propia'}</button></div>`; }).join('')}
        <div class="row" style="margin-top:10px"><button class="btn btn-secondary btn-sm" id="comRecalcular">Recalcular pendientes con las reglas actuales</button></div></div>`;
    })() : '';

    const filtros = `<div class="fx-toolbar">${admin ? `<select id="comAsesor" aria-label="Asesor"><option value="">Todos los asesores</option>${asesoras.map((u) => `<option value="${esc(u.id)}" ${comFiltroAsesor === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
      <select id="comEstado" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(ESTADO_COM).map(([k, v]) => `<option value="${k}" ${comFiltroEstado === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      ${admin ? '<button class="btn btn-primary btn-sm" id="comPagar">Marcar seleccionadas como pagadas</button>' : ''}</div>`;

    const detalle = `<div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr>${admin ? '<th></th>' : ''}<th>Factura</th><th>Fecha</th><th>Cliente</th>${admin ? '<th>Asesor</th>' : ''}<th class="fx-num">Base</th><th>Regla</th><th class="fx-num">Comisión</th><th>Estado</th></tr></thead><tbody>
      ${datos.items.length ? datos.items.map((c) => `<tr>${admin ? `<td>${c.status === 'pendiente' ? `<input type="checkbox" data-com="${esc(c.id)}" aria-label="Seleccionar ${esc(c.invoiceCode)}">` : ''}</td>` : ''}<td><span class="code-pill">${esc(c.invoiceCode)}</span></td><td>${esc(fecha(c.invoiceDate))}</td><td>${esc(c.clientName)}<br><small class="fx-muted">${esc(c.clientCode)}</small></td>${admin ? `<td>${esc(c.advisorName || '—')}</td>` : ''}<td class="fx-num">${c.rule === 'fijo_cbm' ? c.base + ' CBM' : usd(c.base)}</td><td><small>${esc(textoRegla(c.rule, c.rate))}</small></td><td class="fx-num"><b>${usd(c.amount)}</b></td><td>${pillCom(c.status)}${c.paidDate ? `<br><small class="fx-muted">${esc(fecha(c.paidDate))}</small>` : ''}</td></tr>`).join('') : `<tr><td colspan="${admin ? 9 : 7}"><div class="empty compact">No hay comisiones con este filtro.</div></td></tr>`}
    </tbody></table></div></div>`;

    page().innerHTML = `<div class="page-head"><div><h1>Comisiones</h1><p>${admin ? 'Comisiones generadas por las facturas de cada asesor.' : 'Las comisiones que generan tus clientes.'}</p></div></div>${kpis}${reglaAsesor}${reglasHtml}${porCliente}${porAsesor}${filtros}${detalle}`;

    $('comAsesor')?.addEventListener('change', (e) => { comFiltroAsesor = e.target.value; mostrarComisiones(); });
    $('comEstado')?.addEventListener('change', (e) => { comFiltroEstado = e.target.value; mostrarComisiones(); });
    document.querySelectorAll('[data-regla]').forEach((b) => (b.onclick = () => reglaModal(b.dataset.regla, reglas, asesoras)));
    $('comRecalcular')?.addEventListener('click', async () => {
      if (!confirm('Se volverán a calcular las comisiones PENDIENTES con las reglas actuales. Las ya pagadas no se tocan. ¿Continuar?')) return;
      try { const r = await api('/api/comisiones/recalcular', { method: 'POST' }); aviso(`${r.recalculated} comisión(es) recalculadas`); mostrarComisiones(); } catch (e) { aviso(e.message); }
    });
    $('comPagar')?.addEventListener('click', () => {
      const ids = [...document.querySelectorAll('[data-com]:checked')].map((x) => x.dataset.com);
      if (!ids.length) return aviso('Selecciona al menos una comisión pendiente');
      openModal('Marcar comisiones como pagadas', `<p>${ids.length} comisión(es) seleccionada(s).</p>${field('comFechaPago', 'Fecha de pago', hoy(), 'date')}`, '<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="comConfirmar">Confirmar pago</button>');
      $('modalCancel').onclick = closeModal;
      $('comConfirmar').onclick = async () => {
        try { const r = await api('/api/comisiones/pagar', { method: 'POST', body: JSON.stringify({ ids, date: $('comFechaPago').value }) }); closeModal(); aviso(`${r.paid} comisión(es) marcadas como pagadas`); mostrarComisiones(); } catch (e) { aviso(e.message); }
      };
    });
  }

  function reglaModal(asesoraId, reglas, asesoras) {
    const global = !asesoraId;
    const actual = global ? reglas.global : reglas.advisors.find((r) => r.advisorId === asesoraId) || reglas.global;
    const nombre = global ? 'todos los asesores (regla global)' : asesoras.find((u) => u.id === asesoraId)?.name || '';
    openModal(`Regla de comisión · ${esc(nombre)}`, `
      ${selectField('rgTipo', '¿Cómo se calcula?', Object.entries(reglas.types), actual.type)}
      ${field('rgValor', 'Valor', actual.value, 'number', 'min="0" step="0.01"')}
      <small class="fx-muted" id="rgAyuda"></small>
      <p class="fx-muted">Se aplica a las facturas que se emitan desde ahora. Para las ya emitidas y pendientes de pago, usa «Recalcular pendientes».</p>`,
      `<button class="btn btn-secondary" id="modalCancel">Cancelar</button>${!global && reglas.advisors.some((r) => r.advisorId === asesoraId) ? '<button class="btn btn-secondary" id="rgQuitar">Quitar regla propia</button>' : ''}<button class="btn btn-primary" id="rgGuardar">Guardar</button>`);
    $('modalCancel').onclick = closeModal;
    const ayuda = () => { $('rgAyuda').textContent = $('rgTipo').value === 'fijo_cbm' ? 'Valor en dólares por cada m³ (CBM).' : 'Valor en porcentaje (0 a 100).'; };
    $('rgTipo').onchange = ayuda; ayuda();
    $('rgGuardar').onclick = async () => {
      try { await api('/api/comisiones/reglas', { method: 'PUT', body: JSON.stringify({ type: $('rgTipo').value, value: $('rgValor').value, advisorId: asesoraId || null }) }); closeModal(); aviso('Regla guardada'); mostrarComisiones(); } catch (e) { aviso(e.message); }
    };
    $('rgQuitar')?.addEventListener('click', async () => {
      try { await api(`/api/comisiones/reglas/${encodeURIComponent(asesoraId)}`, { method: 'DELETE' }); closeModal(); aviso('Ahora usa la regla global'); mostrarComisiones(); } catch (e) { aviso(e.message); }
    });
  }

  /* =====================================================================================================
     Importar datos (clientes, contenedores y etiquetas desde Excel o CSV)
     ===================================================================================================== */

  const imp = { tipo: 'clientes', archivo: null, analisis: null, mapeo: {}, modo: 'omitir', asesora: '', campos: null, resultado: null, simulado: false };

  async function mostrarImportacion() {
    if (!imp.campos) {
      page().innerHTML = cargando('Importar datos');
      try { imp.campos = await api('/api/importar/campos'); } catch (e) { if (alCambiar('import')) page().innerHTML = fallo('Importar datos', e); return; }
      if (!alCambiar('import')) return;
    }
    pintarImportacion();
  }

  function pintarImportacion() {
    const paso = imp.resultado && !imp.resultado.simulated ? 4 : imp.analisis ? 2 : 1;
    const campos = imp.campos[imp.tipo].fields;
    const asesoras = db.users.filter((u) => u.role === 'asesora' && u.active);
    const r = imp.resultado;

    page().innerHTML = `
      <div class="page-head"><div><h1>Importar datos</h1><p>Trae a este sistema los datos que ya tienes en Excel o CSV (códigos de cliente incluidos), sin escribirlos a mano. Nada se guarda hasta que confirmes.</p></div></div>
      <div class="fx-steps"><span class="fx-step ${paso === 1 ? 'on' : ''}">1 · Archivo</span><span class="fx-step ${paso === 2 ? 'on' : ''}">2 · Columnas y revisión</span><span class="fx-step ${paso === 4 ? 'on' : ''}">3 · Resultado</span></div>
      <div class="fx-box"><h3>1. ¿Qué vas a importar?</h3>
        <div class="fx-grid">
          <div class="field"><label>Tipo de datos</label><select id="impTipo">${Object.entries(imp.campos).map(([k, v]) => `<option value="${k}" ${imp.tipo === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
          <div class="field"><label>Archivo (.xlsx, .xls o .csv, máx. 10 MB)</label><input id="impArchivo" type="file" accept=".xlsx,.xls,.csv"></div>
        </div>
        <small class="fx-muted">${imp.tipo === 'etiquetas' ? 'Importa primero los clientes y los contenedores: cada etiqueta se liga por el código del cliente y el número del contenedor.' : imp.tipo === 'clientes' ? 'El código de cliente se conserva tal como viene (por ejemplo 2-W2089S). Si una fila no lo trae, el sistema le asigna uno.' : 'El número de contenedor identifica cada fila.'}</small>
        <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="impAnalizar">Analizar archivo</button></div>
      </div>
      ${imp.analisis ? `<div class="fx-box"><h3>2. Revisa las columnas</h3>
        <p class="fx-muted" style="margin:0 0 8px">Detecté ${imp.analisis.totalRows} fila(s) en la hoja «${esc(imp.analisis.sheet)}». Confirma qué columna del archivo corresponde a cada dato.</p>
        <div class="fx-grid">${campos.map((c) => `<div class="field"><label>${esc(c.label)}${c.required ? ' *' : ''}</label><select data-mapeo="${esc(c.id)}"><option value="">— no importar —</option>${imp.analisis.headers.map((h) => `<option value="${esc(h)}" ${imp.mapeo[c.id] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div>
        <div class="fx-scroll" style="margin-top:10px"><table class="table"><thead><tr>${imp.analisis.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${imp.analisis.preview.map((f) => `<tr>${f.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <div class="fx-grid" style="margin-top:12px">
          <div class="field"><label>Si el registro ya existe</label><select id="impModo"><option value="omitir" ${imp.modo === 'omitir' ? 'selected' : ''}>Omitirlo (no tocar lo que ya hay)</option><option value="actualizar" ${imp.modo === 'actualizar' ? 'selected' : ''}>Actualizarlo con los datos del archivo</option></select></div>
          ${imp.tipo === 'clientes' ? `<div class="field"><label>Asesor por defecto (si el código del archivo no existe)</label><select id="impAsesora"><option value="">Yo (administrador)</option>${asesoras.map((u) => `<option value="${esc(u.id)}" ${imp.asesora === u.id ? 'selected' : ''}>${esc(u.name)}${u.advisorCode ? ' · ' + esc(u.advisorCode) : ''}</option>`).join('')}</select></div>` : ''}
        </div>
        <div class="row" style="margin-top:12px"><button class="btn btn-secondary" id="impSimular">Simular (no guarda nada)</button><button class="btn btn-primary" id="impAplicar" ${r && r.simulated ? '' : 'disabled'}>Importar de verdad</button></div>
        <small class="fx-muted">Primero simula: te muestra cuántos se crearían y qué filas tienen problemas. «Importar de verdad» se activa después de simular.</small></div>` : ''}
      ${r ? resultadoHtml(r) : ''}`;

    $('impTipo').onchange = (e) => { Object.assign(imp, { tipo: e.target.value, archivo: null, analisis: null, mapeo: {}, resultado: null }); pintarImportacion(); };
    $('impArchivo').onchange = (e) => { imp.archivo = e.target.files[0] || null; imp.analisis = null; imp.resultado = null; };
    $('impAnalizar').onclick = analizarArchivo;
    document.querySelectorAll('[data-mapeo]').forEach((s) => (s.onchange = () => { if (s.value) imp.mapeo[s.dataset.mapeo] = s.value; else delete imp.mapeo[s.dataset.mapeo]; imp.resultado = null; $('impAplicar').disabled = true; }));
    $('impModo')?.addEventListener('change', (e) => { imp.modo = e.target.value; imp.resultado = null; $('impAplicar').disabled = true; });
    $('impAsesora')?.addEventListener('change', (e) => { imp.asesora = e.target.value; });
    $('impSimular')?.addEventListener('click', () => ejecutarImportacion(true));
    $('impAplicar')?.addEventListener('click', () => {
      if (!imp.resultado?.simulated) return aviso('Simula primero');
      if (confirm(`Se guardarán los datos: ${imp.resultado.created} nuevo(s) y ${imp.resultado.updated} actualizado(s). ¿Confirmas la importación?`)) ejecutarImportacion(false);
    });
  }

  function resultadoHtml(r) {
    const lista = (arr, cls) => arr.length ? `<ul class="fx-errors ${cls}">${arr.map((e) => `<li>Fila ${e.row}: ${esc(e.reason)}</li>`).join('')}</ul>` : '';
    return `<div class="fx-box"><h3>${r.simulated ? 'Simulacro (no se guardó nada)' : 'Importación terminada'}</h3>
      <div class="fx-result"><div><b>${r.created}</b>${r.simulated ? 'se crearían' : 'creados'}</div><div><b>${r.updated}</b>${r.simulated ? 'se actualizarían' : 'actualizados'}</div><div><b>${r.skipped}</b>omitidos (ya existían)</div><div><b class="${r.errorCount ? 'fx-bad' : ''}">${r.errorCount}</b>con error</div></div>
      ${r.warnings?.length ? `<p class="fx-warn"><b>Avisos (${r.warnings.length}):</b></p>${lista(r.warnings, 'fx-warn')}` : ''}
      ${r.errorCount ? `<p class="fx-bad"><b>Filas con problemas${r.errors.length < r.errorCount ? ` (se muestran ${r.errors.length})` : ''}:</b> no se importan; corrígelas en el archivo y vuelve a cargarlo.</p>${lista(r.errors, 'fx-bad')}` : '<p>Todas las filas son válidas.</p>'}
      ${!r.simulated ? '<p class="fx-muted">Los datos ya aparecen en Clientes, Etiquetas y Contenedores.</p>' : ''}</div>`;
  }

  async function analizarArchivo() {
    if (!imp.archivo) return aviso('Elige un archivo primero');
    const f = new FormData(); f.append('tipo', imp.tipo); f.append('archivo', imp.archivo);
    try {
      imp.analisis = await enviar('/api/importar/analizar', f);
      imp.mapeo = { ...imp.analisis.mapping }; imp.resultado = null;
      pintarImportacion();
    } catch (e) { aviso(e.message); }
  }

  async function ejecutarImportacion(simular) {
    const req = imp.campos[imp.tipo].fields.filter((c) => c.required && !imp.mapeo[c.id]);
    if (req.length) return aviso(`Falta indicar la columna de: ${req.map((c) => c.label).join(', ')}`);
    const f = new FormData();
    f.append('tipo', imp.tipo); f.append('archivo', imp.archivo); f.append('mapeo', JSON.stringify(imp.mapeo));
    f.append('modo', imp.modo); if (imp.asesora) f.append('asesoraDefecto', imp.asesora); if (simular) f.append('simular', '1');
    try {
      imp.resultado = await enviar('/api/importar/aplicar', f);
      if (!simular) { await loadRemote(); aviso('Importación completada'); }
      pintarImportacion();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (e) { aviso(e.message); }
  }

  /** POST multipart con la sesión (api() fija Content-Type JSON, que rompe los formularios con archivo). */
  async function enviar(ruta, formData) {
    const r = await fetch(ruta, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: formData });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /* =====================================================================================================
     Cliente: acceso a la app móvil
     ===================================================================================================== */

  const clientModalOriginal = window.clientModal;
  window.clientModal = function (existing = null) {
    clientModalOriginal(existing);
    if (!existing || !isAdmin()) return;
    const cuerpo = document.querySelector('#modal .modal-body');
    if (!cuerpo) return;
    cuerpo.insertAdjacentHTML('beforeend', `<div class="fx-box" style="margin-top:14px"><h3>Acceso a la app móvil</h3>
      <p class="fx-muted" style="margin:0 0 8px">El cliente entra a la app con su código <b>${esc(existing.code || '—')}</b> y la clave que definas aquí (mínimo 8 caracteres). Si ya tenía una, se reemplaza.</p>
      <div class="fx-grid">${field('fxAppClave', 'Clave de la app', '', 'password', 'autocomplete="new-password" minlength="8"')}</div>
      <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="fxAppGuardar" type="button">Definir clave</button></div></div>`);
    $('fxAppGuardar').onclick = async () => {
      const clave = $('fxAppClave').value;
      if (clave.length < 8) return aviso('La clave debe tener al menos 8 caracteres');
      try { await api(`/api/clientes/${encodeURIComponent(existing.id)}/clave`, { method: 'PUT', body: JSON.stringify({ clave }) }); $('fxAppClave').value = ''; aviso('Clave de la app guardada'); } catch (e) { aviso(e.message); }
    };
  };

  /* =====================================================================================================
     Etiqueta: lotes y fotos para la app del cliente
     ===================================================================================================== */

  const labelModalOriginal = window.labelModal;
  window.labelModal = function (existing = null, presetClientId = '', presetParentId = '') {
    labelModalOriginal(existing, presetClientId, presetParentId);
    if (!existing || !isAdmin()) return;
    const cuerpo = document.querySelector('#modal .modal-body');
    if (!cuerpo) return;
    cuerpo.insertAdjacentHTML('beforeend', '<div class="fx-box" id="fxApp" style="margin-top:14px"><h3>Lotes y fotos (app del cliente)</h3><span class="fx-muted">Cargando…</span></div>');
    cargarAppEtiqueta(existing);
  };

  async function cargarAppEtiqueta(etq) {
    const caja = $('fxApp');
    let d;
    try { d = await api(`/api/etiquetas/${encodeURIComponent(etq.id)}/app`); } catch (e) { if (caja) caja.innerHTML = `<h3>Lotes y fotos (app del cliente)</h3><span class="fx-bad">${esc(e.message)}</span>`; return; }
    if (!$('fxApp')) return;
    const lotes = d.lots.map((l) => ({ ...l }));
    const nuevaFila = () => ({ name: `Lote ${String.fromCharCode(65 + lotes.length)}`, boxes: '', kgPerBox: '', lengthCm: '', widthCm: '', heightCm: '' });
    const pintar = () => {
      const pesoTotal = r2(lotes.reduce((s, l) => s + num(l.boxes) * num(l.kgPerBox), 0));
      $('fxApp').innerHTML = `<h3>Lotes y fotos (app del cliente)</h3>
        <p class="fx-muted" style="margin:0 0 8px">${d.clientHasAccess ? 'El cliente ya tiene acceso a la app.' : '<span class="fx-warn">El cliente aún no tiene clave de la app (se define en su ficha).</span>'} Lo que cargues aquí lo ve en el detalle de su etiqueta.</p>
        <div class="fx-scroll"><table class="fx-lines"><thead><tr><th>Lote</th><th>Cajas</th><th>kg por caja</th><th>Largo cm</th><th>Ancho cm</th><th>Alto cm</th><th></th></tr></thead><tbody>
          ${lotes.map((l, i) => `<tr>${[['name', 'text', 'fx-desc'], ['boxes', 'number', ''], ['kgPerBox', 'number', ''], ['lengthCm', 'number', ''], ['widthCm', 'number', ''], ['heightCm', 'number', '']].map(([k, t, c]) => `<td><input class="${c}" data-lote="${i}" data-k="${k}" type="${t}" ${t === 'number' ? 'min="0" step="any"' : 'maxlength="80"'} value="${esc(l[k] ?? '')}"></td>`).join('')}<td><button class="btn btn-secondary btn-sm" data-quitar-lote="${i}" type="button" aria-label="Quitar lote">×</button></td></tr>`).join('') || '<tr><td colspan="7"><span class="fx-muted">Sin lotes.</span></td></tr>'}
        </tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="fxLoteMas" type="button">+ Lote</button><button class="btn btn-primary btn-sm" id="fxLoteGuardar" type="button">Guardar lotes</button><span class="fx-muted">Peso total: <b>${pesoTotal} kg</b></span></div>
        <h3 style="margin-top:14px">Fotos</h3>
        <div class="fx-photos" id="fxFotos">${d.photos.map((f) => `<div class="fx-photo" data-foto="${esc(f.id)}"><button type="button" data-borrar-foto="${esc(f.id)}" aria-label="Eliminar foto">×</button><small>${esc(f.title || f.place || 'Foto')}</small></div>`).join('') || '<span class="fx-muted">Sin fotos.</span>'}</div>
        <div class="fx-grid">${field('fxFotoTitulo', 'Título', '', 'text', 'maxlength="120" placeholder="Cajas en almacén"')}${field('fxFotoLugar', 'Lugar', 'Yiwu', 'text', 'maxlength="120"')}<div class="field"><label>Fotos (JPG o PNG)</label><input id="fxFotoArchivos" type="file" accept="image/jpeg,image/png" multiple></div></div>
        <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="fxFotoSubir" type="button">Subir fotos</button></div>`;
      document.querySelectorAll('#fxApp [data-lote]').forEach((el) => (el.oninput = () => { lotes[+el.dataset.lote][el.dataset.k] = el.value; }));
      document.querySelectorAll('#fxApp [data-quitar-lote]').forEach((b) => (b.onclick = () => { lotes.splice(+b.dataset.quitarLote, 1); pintar(); }));
      $('fxLoteMas').onclick = () => { lotes.push(nuevaFila()); pintar(); };
      $('fxLoteGuardar').onclick = async () => {
        try {
          const r = await api(`/api/etiquetas/${encodeURIComponent(etq.id)}/lotes`, { method: 'PUT', body: JSON.stringify({ lotes: lotes.map((l) => ({ nombre: l.name, cajas: l.boxes, kgPorCaja: l.kgPerBox, largoCm: l.lengthCm, anchoCm: l.widthCm, altoCm: l.heightCm })) }) });
          aviso(`${r.lotes} lote(s) guardados`); pintar();
        } catch (e) { aviso(e.message); }
      };
      $('fxFotoSubir').onclick = async () => {
        const files = $('fxFotoArchivos').files;
        if (!files.length) return aviso('Elige al menos una foto');
        const f = new FormData(); f.append('titulo', $('fxFotoTitulo').value); f.append('lugar', $('fxFotoLugar').value);
        [...files].forEach((x) => f.append('fotos', x));
        try { const r = await enviar(`/api/etiquetas/${encodeURIComponent(etq.id)}/fotos`, f); aviso(`${r.guardadas} foto(s) subidas; el cliente recibe el aviso si lo activó`); cargarAppEtiqueta(etq); } catch (e) { aviso(e.message); }
      };
      document.querySelectorAll('#fxApp [data-borrar-foto]').forEach((b) => (b.onclick = async () => {
        if (!confirm('¿Eliminar esta foto?')) return;
        try { await api(`/api/etiquetas/${encodeURIComponent(etq.id)}/fotos/${encodeURIComponent(b.dataset.borrarFoto)}`, { method: 'DELETE' }); cargarAppEtiqueta(etq); } catch (e) { aviso(e.message); }
      }));
      // Miniaturas: las fotos son privadas, se piden con la sesión.
      d.photos.forEach(async (f) => {
        try {
          const url = URL.createObjectURL(await pedirArchivo(`/api/etiquetas/${encodeURIComponent(etq.id)}/fotos/${encodeURIComponent(f.id)}/archivo`));
          const caja2 = document.querySelector(`#fxApp [data-foto="${CSS.escape(f.id)}"]`);
          if (caja2) { const img = new Image(); img.alt = f.title || 'Foto'; img.src = url; caja2.prepend(img); }
        } catch (_) { /* sin miniatura */ }
      });
    };
    pintar();
  }
})();
