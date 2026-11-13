/**
 * Panel (solo administrador): «Contactos por asignar». Clientes del sistema anterior con solo nombre y teléfono; el
 * administrador elige la asesora de cada uno (o de varios a la vez) y en ese momento se crean como clientes suyos.
 *
 * «Cargar archivo» acepta el respaldo .sql del sistema anterior (bloque COPY public.clientes) o un CSV con columnas
 * nombre, apellido, teléfono. El archivo se lee en el navegador y al servidor solo se envían nombre, apellido y teléfono.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const page = () => document.getElementById('page');
  const VISTA = 'contactosAsignar';
  const esAdmin = () => me()?.role === 'admin';
  const ESTADOS = { pendiente: 'Por asignar', asignado: 'Asignados', descartado: 'Descartados' };
  let estado = 'pendiente', busqueda = '', datos = null, cargando = false;
  const marcados = new Set();

  /* ---------- Leer el archivo ---------- */

  /** Respaldo de PostgreSQL: toma el bloque COPY de la tabla clientes y saca solo nombre, apellido y teléfono. */
  function desdeSql(txt) {
    const m = txt.match(/^COPY\s+(?:public\.)?clientes\s*\(([^)]*)\)\s+FROM\s+stdin;\s*$/im);
    if (!m) return null;
    const cols = m[1].split(',').map((c) => c.trim().replace(/"/g, ''));
    const iN = cols.indexOf('nombre'), iA = cols.indexOf('apellido'), iT = cols.indexOf('telefono');
    if (iN < 0) throw new Error('El respaldo no tiene la columna «nombre» en clientes');
    const desde = txt.indexOf(m[0]) + m[0].length;
    const out = [];
    const val = (v) => (v == null || v === '\\N' ? '' : v.replace(/\\t/g, ' ').replace(/\\n/g, ' ').replace(/\\\\/g, '\\'));
    for (const linea of txt.slice(desde).split(/\r?\n/)) {
      if (linea === '\\.') break;
      if (!linea) continue;
      const c = linea.split('\t');
      out.push({ nombre: val(c[iN]), apellido: iA >= 0 ? val(c[iA]) : '', telefono: iT >= 0 ? val(c[iT]) : '' });
    }
    return out;
  }

  /** CSV (coma o punto y coma) con encabezados nombre / apellido / teléfono (también name / phone). */
  function desdeCsv(txt) {
    const filas = txt.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    if (filas.length < 2) throw new Error('El CSV está vacío');
    const sep = (filas[0].match(/;/g) || []).length > (filas[0].match(/,/g) || []).length ? ';' : ',';
    const partir = (l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
    const norm = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
    const cab = partir(filas[0]).map(norm);
    const busca = (...n) => cab.findIndex((h) => n.includes(h));
    const iN = busca('nombre', 'name', 'nombrecompleto', 'cliente'), iA = busca('apellido', 'apellidos', 'lastname'), iT = busca('telefono', 'phone', 'celular', 'whatsapp', 'tlf');
    if (iN < 0 || iT < 0) throw new Error('El CSV necesita las columnas «nombre» y «teléfono»');
    return filas.slice(1).map((l) => { const c = partir(l); return { nombre: c[iN] || '', apellido: iA >= 0 ? c[iA] || '' : '', telefono: c[iT] || '' }; });
  }

  async function cargarArchivo(archivo) {
    let lista;
    try {
      const txt = await archivo.text();
      lista = desdeSql(txt) || desdeCsv(txt);
    } catch (e) { return toast(e.message || 'No se pudo leer el archivo'); }
    lista = lista.filter((x) => x.nombre.trim());
    if (!lista.length) return toast('El archivo no trae contactos');
    if (!confirm(`Se encontraron ${lista.length} contacto(s). Se cargan solo nombre, apellido y teléfono; los que ya son clientes o ya están cargados se saltan. ¿Continuar?`)) return;
    try {
      const r = await api('/api/contactos/cargar', { method: 'POST', body: JSON.stringify({ contactos: lista }) });
      toast(`${r.creados} contacto(s) nuevos · ${r.repetidos} ya estaban cargados · ${r.yaClientes} ya eran clientes`);
      estado = 'pendiente'; mostrar();
    } catch (e) { toast(e.message); }
  }

  /* ---------- Menú ---------- */

  const shellOriginal = window.shellHTML;
  window.shellHTML = function () {
    const html = shellOriginal();
    if (!esAdmin()) return html;
    const boton = `<button data-view="${VISTA}" title="Contactos del sistema anterior por asignar"><span class="nav-label">Contactos por asignar</span></button>`;
    const conBoton = html.replace(/(<button[^>]*data-view="portfolio"[^>]*>[\s\S]*?<\/button>)/, `$1${boton}`);
    return conBoton === html ? html.replace('</nav>', `${boton}</nav>`) : conBoton;
  };

  const renderOriginal = window.renderView;
  window.renderView = function () {
    if (currentView !== VISTA) return renderOriginal();
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
    if (page()) mostrar();
  };

  /* ---------- Vista ---------- */

  const asesoras = () => db.users.filter((u) => u.role === 'asesora' && u.active).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const opcionesAsesora = (txt = 'Elegir asesora…') => `<option value="">${txt}</option>${asesoras().map((u) => `<option value="${esc(u.id)}">${esc(u.name)}${u.advisorCode ? ` · ${esc(u.advisorCode)}` : ''}</option>`).join('')}`;

  async function mostrar() {
    if (!esAdmin()) { page().innerHTML = '<div class="card section"><div class="empty">Solo el administrador.</div></div>'; return; }
    if (cargando) return;
    cargando = true;
    page().innerHTML = '<div class="page-head"><div><h1>Contactos por asignar</h1><p>Cargando…</p></div></div>';
    try { datos = await api(`/api/contactos?estado=${estado}`); } catch (e) {
      cargando = false;
      if (currentView === VISTA) page().innerHTML = `<div class="page-head"><div><h1>Contactos por asignar</h1></div></div><div class="card section"><div class="empty">${esc(e.message)}</div></div>`;
      return;
    }
    cargando = false;
    if (currentView !== VISTA || !page()) return;
    marcados.clear();
    pintar();
  }

  function pintar() {
    const t = datos.totales || {};
    const q = busqueda.trim().toLowerCase();
    const qDig = q.replace(/\D/g, '');
    const lista = datos.contactos.filter((k) => !q || `${k.nombre} ${k.apellido}`.toLowerCase().includes(q) || (qDig.length >= 3 && k.telefono.replace(/\D/g, '').includes(qDig)));
    const pend = estado === 'pendiente';
    page().innerHTML = `
      <div class="page-head"><div><h1>Contactos por asignar</h1><p>Clientes del sistema anterior, con solo nombre y teléfono. Elige la asesora de cada uno: al asignarlo se crea como cliente suyo.</p></div>
        <div class="row"><input type="file" id="ctArchivo" accept=".sql,.csv,.txt" hidden><button class="btn btn-secondary" id="ctCargar">Cargar archivo</button></div></div>
      <div class="fx-toolbar">
        ${Object.entries(ESTADOS).map(([k, v]) => `<button class="btn ${estado === k ? 'btn-primary' : 'btn-secondary'} btn-sm" data-ct-estado="${k}">${v} (${t[k] || 0})</button>`).join('')}
        <input type="search" id="ctBuscar" placeholder="Buscar nombre o teléfono" value="${esc(busqueda)}" style="min-width:220px">
      </div>
      ${pend && lista.length ? `<div class="fx-toolbar"><label class="wt-check" style="margin:0"><input type="checkbox" id="ctTodos"> Marcar los ${lista.length} visibles</label>
        <select id="ctAsesoraLote" aria-label="Asesora para los marcados">${opcionesAsesora('Asignar marcados a…')}</select>
        <button class="btn btn-primary btn-sm" id="ctAsignarLote">Asignar marcados (<span id="ctN">0</span>)</button></div>` : ''}
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr>${pend ? '<th></th>' : ''}<th>Cliente</th><th>Teléfono</th><th>${pend ? 'Asignar a' : estado === 'asignado' ? 'Asesora / cliente creado' : ''}</th><th></th></tr></thead><tbody>
        ${lista.map((k) => `<tr>
          ${pend ? `<td><input type="checkbox" data-ct-marca="${esc(k.id)}" aria-label="Marcar ${esc(k.nombre)}"></td>` : ''}
          <td><b>${esc(k.nombre)} ${esc(k.apellido)}</b></td>
          <td>${esc(k.telefono || '—')}</td>
          <td>${pend ? `<select data-ct-asesora="${esc(k.id)}" aria-label="Asesora para ${esc(k.nombre)}">${opcionesAsesora()}</select>`
            : estado === 'asignado' ? `${esc(k.asesoraNombre || '—')}${k.clienteCodigo ? ` <span class="code-pill">${esc(k.clienteCodigo)}</span>` : ''}` : ''}</td>
          <td>${pend ? `<button class="btn btn-secondary btn-sm" data-ct-descartar="${esc(k.id)}">Descartar</button>` : estado === 'descartado' ? `<button class="btn btn-secondary btn-sm" data-ct-recuperar="${esc(k.id)}">Volver a por asignar</button>` : ''}</td></tr>`).join('')
          || `<tr><td colspan="5"><div class="empty compact">${q ? 'Nada coincide con la búsqueda.' : pend ? 'No hay contactos por asignar. Usa «Cargar archivo» para traer los del sistema anterior.' : 'No hay contactos aquí.'}</div></td></tr>`}
      </tbody></table></div></div>`;

    $('ctCargar').onclick = () => $('ctArchivo').click();
    $('ctArchivo').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) cargarArchivo(f); };
    document.querySelectorAll('[data-ct-estado]').forEach((b) => (b.onclick = () => { estado = b.dataset.ctEstado; mostrar(); }));
    $('ctBuscar').oninput = (e) => { busqueda = e.target.value; const pos = e.target.selectionStart; pintar(); const n = $('ctBuscar'); n.focus(); n.setSelectionRange(pos, pos); };
    const contar = () => { const n = $('ctN'); if (n) n.textContent = marcados.size; };
    document.querySelectorAll('[data-ct-marca]').forEach((c) => {
      c.checked = marcados.has(c.dataset.ctMarca);
      c.onchange = () => { c.checked ? marcados.add(c.dataset.ctMarca) : marcados.delete(c.dataset.ctMarca); contar(); };
    });
    $('ctTodos')?.addEventListener('change', (e) => { document.querySelectorAll('[data-ct-marca]').forEach((c) => { c.checked = e.target.checked; c.onchange(); }); });
    contar();
    document.querySelectorAll('[data-ct-asesora]').forEach((s) => (s.onchange = () => { if (s.value) asignar([s.dataset.ctAsesora], s.value); }));
    $('ctAsignarLote')?.addEventListener('click', () => {
      const a = $('ctAsesoraLote').value;
      if (!marcados.size) return toast('Marca al menos un contacto');
      if (!a) return toast('Elige la asesora');
      const nombre = asesoras().find((u) => u.id === a)?.name || '';
      if (confirm(`¿Asignar ${marcados.size} contacto(s) a ${nombre}? Se crearán como clientes suyos.`)) asignar([...marcados], a);
    });
    document.querySelectorAll('[data-ct-descartar]').forEach((b) => (b.onclick = () => cambiar(b.dataset.ctDescartar, 'descartado')));
    document.querySelectorAll('[data-ct-recuperar]').forEach((b) => (b.onclick = () => cambiar(b.dataset.ctRecuperar, 'pendiente')));
  }

  async function asignar(ids, advisorId) {
    try {
      const r = await api('/api/contactos/asignar', { method: 'POST', body: JSON.stringify({ ids, advisorId }) });
      const nombre = asesoras().find((u) => u.id === advisorId)?.name || 'la asesora';
      let msg = `${r.asignados} cliente(s) creados para ${nombre}`;
      if (r.yaClientes?.length) msg += ` · ${r.yaClientes.length} ya eran clientes: ${r.yaClientes.slice(0, 3).join(', ')}${r.yaClientes.length > 3 ? '…' : ''}`;
      toast(msg);
      try { await loadRemote(); } catch { /* la lista de clientes se actualiza al recargar */ }
      if (currentView === VISTA) mostrar();
    } catch (e) { toast(e.message); }
  }

  async function cambiar(id, nuevo) {
    try { await api(`/api/contactos/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ estado: nuevo }) }); mostrar(); } catch (e) { toast(e.message); }
  }
})();
