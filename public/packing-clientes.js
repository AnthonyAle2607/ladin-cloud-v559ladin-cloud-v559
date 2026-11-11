/**
 * Panel: packing lists que envía el CLIENTE desde la app móvil (la IA ya los revisó y leyó en el servidor).
 *  - Menú «Seguimiento → Packing lists»: lo que llegó, con lo que leyó la IA; vincular a una etiqueta o descartar.
 *  - En cada etiqueta: «Packing list del cliente», para comparar lo que la asesora llenó a mano con lo que leyó la IA
 *    y corregirlo («la IA corrige al que no sabe»). En el panel nadie usa la IA directamente.
 * Se carga después de app.js, facturacion.js y documentos.js; usa sus funciones globales.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const page = () => document.getElementById('page');
  const VISTA = 'packingClientes';
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const num = (v) => (v == null || v === '' ? '—' : String(v).replace('.', ','));

  async function abrirArchivo(p) {
    try {
      const r = await fetch(`/api/packing-clientes/${encodeURIComponent(p.id)}/archivo`, { headers: { Authorization: `Bearer ${session.token}` } });
      if (!r.ok) throw new Error('No se pudo abrir el archivo');
      const url = URL.createObjectURL(await r.blob());
      if (/^image\//.test(p.mime)) window.open(url, '_blank', 'noopener');
      else { const a = document.createElement('a'); a.href = url; a.download = p.nombre || 'packing-list'; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { toast(e.message); }
  }

  const lectura = (p) => (p.datos
    ? `<b>${num(p.datos.cajas)}</b> cajas · <b>${num(p.datos.cbm)}</b> CBM${p.datos.mercancia ? ` · ${esc(p.datos.mercancia)}` : ''}${p.datos.proveedor ? `<br><small class="fx-muted">${esc(p.datos.proveedor)}${p.datos.numeroDocumento ? ` · N.º ${esc(p.datos.numeroDocumento)}` : ''}</small>` : ''}`
    : `<span class="fx-warn">Sin revisar por la IA</span>${p.motivo ? `<br><small class="fx-muted">${esc(p.motivo)}</small>` : ''}`);

  /* ---------- Menú ---------- */

  const shellOriginal = window.shellHTML;
  window.shellHTML = function () {
    const html = shellOriginal();
    const boton = `<button data-view="${VISTA}" title="Packing lists de clientes"><span class="nav-label">Packing lists</span></button>`;
    const conBoton = html.replace(/(<button[^>]*data-view="portfolio"[^>]*>[\s\S]*?<\/button>)/, `$1${boton}`);
    return conBoton === html ? html.replace('</nav>', `${boton}</nav>`) : conBoton;
  };

  const renderOriginal = window.renderView;
  window.renderView = function () {
    if (currentView !== VISTA) return renderOriginal();
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
    if (page()) mostrar();
  };

  /* ---------- Vista «Packing lists» ---------- */

  let verTodos = false;

  async function mostrar() {
    page().innerHTML = '<div class="page-head"><div><h1>Packing lists de clientes</h1><p>Cargando…</p></div></div>';
    let lista;
    try { lista = await api(`/api/packing-clientes${verTodos ? '' : '?pendientes=1'}`); } catch (e) { if (currentView === VISTA) page().innerHTML = `<div class="page-head"><div><h1>Packing lists de clientes</h1></div></div><div class="card section"><div class="empty">${esc(e.message)}</div></div>`; return; }
    if (currentView !== VISTA || !page()) return;
    if (verTodos) lista = lista.filter((p) => p.estado !== 'descartado');
    page().innerHTML = `
      <div class="page-head"><div><h1>Packing lists de clientes</h1><p>Los envían los clientes desde la app; la IA revisa que sean packing lists y lee cajas, CBM y mercancía. Vincúlalos a su etiqueta para comparar con lo que llenaste.</p></div>
        <div class="row"><label class="wt-check" style="margin:0"><input type="checkbox" id="pkTodos" ${verTodos ? 'checked' : ''}> Ver también los ya vinculados</label></div></div>
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Recibido</th><th>Cliente</th><th>Lo que leyó la IA</th><th>Etiqueta</th><th></th></tr></thead><tbody>
        ${lista.map((p) => {
          const propias = db.labels.filter((l) => sameRefId(l.clientId, p.clienteId));
          return `<tr><td>${esc(fecha(p.fecha))}</td>
            <td><span class="code-pill">${esc(p.clienteCodigo || '—')}</span> <b>${esc(p.clienteNombre)}</b></td>
            <td>${lectura(p)}</td>
            <td>${p.etiquetaId ? `<span class="code-pill">${esc(p.etiquetaNumero)}</span>` : propias.length
              ? `<select data-pk-etq="${esc(p.id)}" aria-label="Etiqueta"><option value="">Elegir etiqueta…</option>${propias.map((l) => `<option value="${esc(l.id)}">${esc(l.number)}</option>`).join('')}</select>`
              : '<span class="fx-muted">El cliente no tiene etiquetas aún: créala y vuelve.</span>'}</td>
            <td><div class="fx-table-actions"><button class="btn btn-secondary btn-sm" data-pk-ver="${esc(p.id)}">Ver archivo</button>${p.etiquetaId ? '' : `<button class="btn btn-secondary btn-sm" data-pk-descartar="${esc(p.id)}">Descartar</button>`}</div></td></tr>`;
        }).join('') || `<tr><td colspan="5"><div class="empty compact">${verTodos ? 'Todavía no hay packing lists de clientes.' : 'No hay packing lists pendientes de vincular.'}</div></td></tr>`}
      </tbody></table></div></div>`;
    $('pkTodos').onchange = (e) => { verTodos = e.target.checked; mostrar(); };
    document.querySelectorAll('[data-pk-ver]').forEach((b) => (b.onclick = () => abrirArchivo(lista.find((p) => p.id === b.dataset.pkVer))));
    document.querySelectorAll('[data-pk-etq]').forEach((s) => (s.onchange = async () => {
      if (!s.value) return;
      try { await api(`/api/packing-clientes/${encodeURIComponent(s.dataset.pkEtq)}`, { method: 'PUT', body: JSON.stringify({ etiquetaId: s.value }) }); toast('Packing list vinculado a la etiqueta'); mostrar(); } catch (e) { toast(e.message); }
    }));
    document.querySelectorAll('[data-pk-descartar]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Descartar este packing list? El cliente dejará de verlo en su app.')) return;
      try { await api(`/api/packing-clientes/${encodeURIComponent(b.dataset.pkDescartar)}`, { method: 'PUT', body: JSON.stringify({ estado: 'descartado' }) }); toast('Descartado'); mostrar(); } catch (e) { toast(e.message); }
    }));
  }

  /* ---------- En la etiqueta: comparar y corregir ---------- */

  const CAMPOS = [['mBoxesPacking', 'cajas', 'Cajas'], ['mCbmPacking', 'cbm', 'CBM'], ['mCargoType', 'mercancia', 'Mercancía']];
  const igual = (a, b) => {
    const x = String(a ?? '').trim(), y = String(b ?? '').trim();
    if (x === y) return true;
    const nx = Number(x.replace(',', '.')), ny = Number(y.replace(',', '.'));
    if (x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)) return Math.abs(nx - ny) < 0.0005;
    return x.toLowerCase() === y.toLowerCase();
  };

  function cajaEtiqueta(cuerpo, etq) {
    cuerpo.insertAdjacentHTML('beforeend', '<div class="fx-box" id="pkEtq" style="margin-top:14px"><h3>Packing list del cliente</h3><span class="fx-muted">Cargando…</span></div>');
    pintarCaja(etq);
  }

  async function pintarCaja(etq) {
    let suyos, sueltos;
    try {
      [suyos, sueltos] = await Promise.all([
        api(`/api/packing-clientes?etiqueta=${encodeURIComponent(etq.id)}`),
        api(`/api/packing-clientes?pendientes=1&cliente=${encodeURIComponent(etq.clientId)}`),
      ]);
    } catch (e) { if ($('pkEtq')) $('pkEtq').innerHTML = `<h3>Packing list del cliente</h3><span class="fx-bad">${esc(e.message)}</span>`; return; }
    const caja = $('pkEtq');
    if (!caja) return;
    const leido = suyos.filter((p) => p.estado !== 'descartado').find((p) => p.datos);
    const sinLeer = suyos.filter((p) => p.estado !== 'descartado' && !p.datos);
    const vincular = sueltos.length ? `<div style="margin-top:10px"><b>El cliente envió ${sueltos.length} packing list(s) sin etiqueta:</b>${sueltos.map((p) => `<div class="fx-rule-row"><span>${esc(fecha(p.fecha))} · ${lectura(p)}</span><span><button class="btn btn-secondary btn-sm" type="button" data-pk-ver2="${esc(p.id)}">Ver</button> <button class="btn btn-primary btn-sm" type="button" data-pk-vincular="${esc(p.id)}">Vincular a esta etiqueta</button></span></div>`).join('')}</div>` : '';
    if (!leido) {
      caja.innerHTML = `<h3>Packing list del cliente</h3><p class="fx-muted" style="margin:0">${sinLeer.length ? `El cliente envió ${sinLeer.length} archivo(s) que la IA no pudo revisar: ábrelos y compara a mano.` : 'El cliente aún no ha enviado el packing list de esta etiqueta desde su app.'}</p>${sinLeer.map((p) => `<button class="btn btn-secondary btn-sm" type="button" data-pk-ver2="${esc(p.id)}" style="margin-top:6px">Ver ${esc(p.nombre)}</button>`).join(' ')}${vincular}`;
    } else {
      caja.innerHTML = `<h3>Packing list del cliente</h3>
        <p class="fx-muted" style="margin:0 0 8px">Enviado desde la app el ${esc(fecha(leido.fecha))}${leido.datos.proveedor ? ` · ${esc(leido.datos.proveedor)}` : ''}. Compara con lo que llenaste:</p>
        <div class="fx-scroll"><table class="fx-lines"><thead><tr><th></th><th>Lo que llenaste</th><th>Packing list (IA)</th><th></th></tr></thead><tbody id="pkComparar"></tbody></table></div>
        <div class="row" style="margin-top:8px;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" type="button" id="pkCorregir">Corregir con el packing list</button><button class="btn btn-secondary btn-sm" type="button" data-pk-ver2="${esc(leido.id)}">Ver archivo</button></div>
        <p id="pkResultado" style="margin:8px 0 0"></p>${vincular}`;
      const comparar = () => {
        const filas = CAMPOS.map(([id, k, t]) => {
          const el = $(id);
          if (!el) return '';
          const tuyo = el.value, suyo = leido.datos[k];
          const ok = suyo == null || suyo === '' || igual(tuyo, suyo);
          return `<tr><td><b>${t}</b></td><td>${esc(tuyo || '—')}</td><td>${esc(num(suyo))}</td><td>${ok ? '<span style="color:var(--green)">✓</span>' : '<span class="fx-bad">No coincide</span>'}</td></tr>`;
        });
        if ($('pkComparar')) $('pkComparar').innerHTML = filas.join('');
      };
      comparar();
      CAMPOS.forEach(([id]) => $(id)?.addEventListener('input', comparar));
      $('pkCorregir').onclick = () => {
        const cambios = [];
        for (const [id, k, t] of CAMPOS) {
          const el = $(id), suyo = leido.datos[k];
          if (!el || el.readOnly || suyo == null || suyo === '' || igual(el.value, suyo)) continue;
          cambios.push(`${t === 'CBM' ? t : t.toLowerCase()}: ${el.value || 'vacío'} → ${suyo}`);
          el.value = suyo;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.style.outline = '2px solid var(--brick, #b4492b)';
          setTimeout(() => { el.style.outline = ''; }, 6000);
        }
        $('pkResultado').innerHTML = cambios.length ? `<span class="fx-bad"><b>Corregido según el packing list del cliente:</b> ${esc(cambios.join(' · '))}. Guarda para aplicar.</span>` : '<span class="fx-muted">Lo que llenaste ya coincide con el packing list.</span>';
        comparar();
      };
    }
    caja.querySelectorAll('[data-pk-ver2]').forEach((b) => (b.onclick = () => abrirArchivo([...suyos, ...sueltos].find((p) => p.id === b.dataset.pkVer2))));
    caja.querySelectorAll('[data-pk-vincular]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/packing-clientes/${encodeURIComponent(b.dataset.pkVincular)}`, { method: 'PUT', body: JSON.stringify({ etiquetaId: etq.id }) }); toast('Packing list vinculado'); pintarCaja(etq); } catch (e) { toast(e.message); }
    }));
  }

  const labelModalAnterior = window.labelModal;
  window.labelModal = function (existing = null, ...resto) {
    labelModalAnterior(existing, ...resto);
    const cuerpo = document.querySelector('#modal .modal-body');
    if (!cuerpo) return;
    if (existing?.id) cajaEtiqueta(cuerpo, existing);
    else cuerpo.insertAdjacentHTML('beforeend', '<div class="fx-box" style="margin-top:14px"><h3>Packing list del cliente</h3><span class="fx-muted">Llena los datos a mano. Si el cliente envió su packing list desde la app, guarda la etiqueta y ábrela de nuevo para compararlo y vincularlo.</span></div>');
  };
})();
