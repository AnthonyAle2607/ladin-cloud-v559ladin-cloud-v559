/**
 * Filtro por mes de los apartados estadísticos (Estadísticas, Reportes, Facturación y Comisiones).
 * «Global» muestra todo, como siempre; al elegir un mes solo se cuenta lo registrado ese mes:
 * clientes y etiquetas por su fecha de registro, actividad e incidencias por su fecha, recordatorios por su vencimiento,
 * facturas y comisiones por la fecha de la factura. El mes elegido se recuerda en este navegador.
 * Se carga DESPUÉS de app.js; usa db, renderView y esc de app.js.
 */
(function () {
  'use strict';

  const CLAVE = 'ladin.periodo';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  let valor = '';
  try { valor = localStorage.getItem(CLAVE) || ''; } catch (_) { /* sin almacenamiento: empieza en Global */ }
  if (!/^\d{4}-\d{2}$/.test(valor)) valor = '';

  /** "2026-10-08", "2026-10-08T14:00:00Z" o Date → "2026-10". */
  function mesDe(f) {
    if (!f) return '';
    if (f instanceof Date) return Number.isNaN(f.getTime()) ? '' : `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
    const s = String(f);
    if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
    return mesDe(new Date(s));
  }
  const nombreMes = (k) => { const [a, m] = k.split('-'); return `${MESES[Number(m) - 1]} ${a}`; };
  const en = (f) => !valor || mesDe(f) === valor;

  /** Selector con los últimos 24 meses más los que aparezcan en los datos. */
  function selector(fechas = []) {
    const meses = new Set(fechas.map(mesDe).filter(Boolean));
    const hoy = new Date();
    for (let i = 0; i < 24; i++) meses.add(mesDe(new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)));
    if (valor) meses.add(valor);
    const lista = [...meses].sort().reverse();
    return `<div class="periodo-bar"><label for="periodoMes">Período</label><select id="periodoMes"><option value="">Global (todo)</option>${lista.map((k) => `<option value="${k}" ${k === valor ? 'selected' : ''}>${nombreMes(k)}</option>`).join('')}</select>${valor ? `<span class="periodo-nota">Solo lo registrado en ${nombreMes(valor)}</span>` : ''}</div>`;
  }

  document.addEventListener('change', (e) => {
    if (e.target?.id !== 'periodoMes') return;
    valor = e.target.value;
    try { if (valor) localStorage.setItem(CLAVE, valor); else localStorage.removeItem(CLAVE); } catch (_) { /* sin almacenamiento */ }
    renderView();
  });

  /** Pone el selector debajo del título de la página (o arriba, si la página no tiene el encabezado de siempre). */
  function conSelector(html, sel) {
    const r = /(<div class="page-head"><div><h1>[^<]*<\/h1><p>[\s\S]*?<\/p>)/;
    return r.test(html) ? html.replace(r, (m) => m + sel) : sel + html;
  }

  /** Estadísticas y Reportes leen `db` directamente: mientras se dibujan, `db` es una copia con solo lo del mes. */
  // Reportes maneja el período por su cuenta (necesita también los datos de hoy: activas y clientes).
  for (const nombre of ['statsView']) {
    const original = window[nombre];
    if (typeof original !== 'function') continue;
    window[nombre] = function () {
      const sel = selector([...db.clients.map((c) => c.createdAt), ...db.labels.map((l) => l.createdAt)]);
      if (!valor) return conSelector(original(), sel);
      const real = db;
      db = {
        ...real,
        clients: real.clients.filter((c) => en(c.createdAt)),
        labels: real.labels.filter((l) => en(l.createdAt)),
        history: (real.history || []).filter((h) => en(h.createdAt)),
        reminders: (real.reminders || []).filter((r) => en(r.dueAt)),
        complaints: (real.complaints || []).filter((q) => en(q.createdAt)),
      };
      try { return conSelector(original(), sel); } finally { db = real; }
    };
  }

  window.Periodo = { valor: () => valor, en, selector, mesDe };
})();
