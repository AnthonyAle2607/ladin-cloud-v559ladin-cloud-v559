/**
 * Documentos adjuntos en las fichas de cliente (cédula, RIF…) y de etiqueta (packing list, fotos de la mercancía y de las cajas…).
 * Se carga DESPUÉS de app.js y facturacion.js y se engancha a sus modales. Usa api, session, esc, toast y me de app.js.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  let tipos = null; // { cliente: {clave: texto}, etiqueta: {...} } — se piden una vez al servidor

  const pesoTexto = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const fechaTexto = (f) => { const d = new Date(f); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: 'numeric' }); };

  /** Reduce fotos grandes a 1600 px (en Vercel una solicitud no puede pasar de 4.5 MB). PDF, Excel y Word van tal cual. */
  async function reducir(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 700 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(bmp.width * escala); lienzo.height = Math.round(bmp.height * escala);
      lienzo.getContext('2d').drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
      const blob = await new Promise((r) => lienzo.toBlob(r, 'image/jpeg', 0.85));
      return blob && blob.size < file.size ? new File([blob], `${file.name.replace(/\.\w+$/, '')}.jpg`, { type: 'image/jpeg' }) : file;
    } catch (_) { return file; }
  }

  async function subirArchivo(ruta, tipo, file) {
    const f = new FormData();
    f.append('tipo', tipo);
    f.append('archivos', await reducir(file));
    const r = await fetch(ruta, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /** Abre PDF e imágenes en otra pestaña; Excel y Word se descargan. Los archivos son privados: se piden con la sesión. */
  async function abrir(doc) {
    const enLinea = /^(image\/|application\/pdf)/.test(doc.mime);
    const ventana = enLinea ? window.open('', '_blank') : null; // se abre ya, dentro del clic, para que el navegador no la bloquee
    try {
      const r = await fetch(`/api/documentos/${encodeURIComponent(doc.id)}/archivo`, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
      if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch (_) {} throw new Error(m); }
      const url = URL.createObjectURL(await r.blob());
      if (ventana) ventana.location = url;
      else { const a = document.createElement('a'); a.href = url; a.download = doc.nombre; document.body.appendChild(a); a.click(); a.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { ventana?.close(); toast(e.message); }
  }

  async function seccion(cuerpo, entidad, registro) {
    const ruta = `/api/${entidad === 'cliente' ? 'clientes' : 'etiquetas'}/${encodeURIComponent(registro.id)}/documentos`;
    cuerpo.insertAdjacentHTML('beforeend', '<div class="fx-box" id="docBox" style="margin-top:14px"><h3>Documentos</h3><span class="fx-muted">Cargando…</span></div>');
    const caja = $('docBox');
    try { if (!tipos) tipos = await api('/api/documentos/tipos'); } catch (e) { caja.innerHTML = `<h3>Documentos</h3><span class="fx-bad">${esc(e.message)}</span>`; return; }
    const opciones = Object.entries(tipos[entidad] || {});

    const pintar = async () => {
      let lista;
      try { lista = await api(ruta); } catch (e) { if ($('docBox')) $('docBox').innerHTML = `<h3>Documentos</h3><span class="fx-bad">${esc(e.message)}</span>`; return; }
      if (!$('docBox')) return; // el modal se cerró mientras cargaba
      $('docBox').innerHTML = `<h3>Documentos</h3>
        <p class="fx-muted" style="margin:0 0 8px">${entidad === 'cliente' ? 'Cédula, RIF y demás documentos del cliente.' : 'Packing list, factura y fotos de la mercancía y de las cajas.'} PDF, fotos, Excel o Word de hasta 10 MB.</p>
        <div class="doc-list">${lista.map((d) => `<div class="doc-row"><span class="code-pill">${esc(d.tipoTexto)}</span><button type="button" class="link-btn doc-name" data-doc-abrir="${esc(d.id)}" title="Abrir">${esc(d.nombre)}</button><small class="fx-muted">${esc(pesoTexto(d.tamano))} · ${esc(fechaTexto(d.fecha))}${d.subidoPor ? ` · ${esc(d.subidoPor)}` : ''}</small><button type="button" class="btn btn-secondary btn-sm" data-doc-borrar="${esc(d.id)}" aria-label="Eliminar ${esc(d.nombre)}">×</button></div>`).join('') || '<span class="fx-muted">Sin documentos.</span>'}</div>
        <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:8px"><select id="docTipo" aria-label="Tipo de documento">${opciones.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select><input id="docArchivos" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,.xlsx,.xls,.docx,.doc" aria-label="Archivos"><button class="btn btn-primary btn-sm" id="docSubir" type="button">Adjuntar</button></div>`;
      document.querySelectorAll('#docBox [data-doc-abrir]').forEach((b) => (b.onclick = () => abrir(lista.find((d) => d.id === b.dataset.docAbrir))));
      document.querySelectorAll('#docBox [data-doc-borrar]').forEach((b) => (b.onclick = async () => {
        const d = lista.find((x) => x.id === b.dataset.docBorrar);
        if (!d || !confirm(`¿Eliminar «${d.nombre}»?`)) return;
        try { await api(`/api/documentos/${encodeURIComponent(d.id)}`, { method: 'DELETE' }); toast('Documento eliminado'); pintar(); } catch (e) { toast(e.message); }
      }));
      $('docSubir').onclick = async () => {
        const archivos = [...$('docArchivos').files];
        if (!archivos.length) return toast('Elige al menos un archivo');
        const boton = $('docSubir'), tipo = $('docTipo').value;
        boton.disabled = true;
        let ok = 0; const fallos = []; const sinRevisar = [];
        // Las asesoras: un «Packing list» lo revisa la IA antes de guardarlo (puede tardar unos segundos).
        const revisa = tipo === 'packing_list' && me()?.role !== 'admin';
        // Uno por solicitud: así ninguna pasa del límite de 4.5 MB de Vercel.
        for (const [i, file] of archivos.entries()) {
          boton.textContent = `${revisa ? 'Revisando con IA y subiendo' : 'Subiendo'} ${i + 1} de ${archivos.length}…`;
          try {
            const r = await subirArchivo(ruta, tipo, file);
            ok += r.guardados;
            sinRevisar.push(...(r.sinRevisar || []));
            fallos.push(...(r.rechazados || []).filter((x) => /packing list/.test(x)));
          } catch (e) { fallos.push(`${file.name}: ${e.message}`); }
        }
        toast(fallos.length ? `${ok} subido(s). No se pudo: ${fallos.join(' · ')}` : `${ok} documento(s) adjuntados${sinRevisar.length ? ` · sin revisar por la IA: ${sinRevisar.join(', ')}` : ''}`);
        pintar();
      };
    };
    pintar();
  }

  function enganchar(nombre, entidad) {
    const original = window[nombre];
    window[nombre] = function (existing = null, ...resto) {
      original(existing, ...resto);
      const cuerpo = document.querySelector('#modal .modal-body');
      if (!cuerpo) return;
      if (existing?.id) seccion(cuerpo, entidad, existing);
      else cuerpo.insertAdjacentHTML('beforeend', `<div class="fx-box" style="margin-top:14px"><h3>Documentos</h3><span class="fx-muted">Guarda ${entidad === 'cliente' ? 'el cliente' : 'la etiqueta'} y ábrelo de nuevo para adjuntar ${entidad === 'cliente' ? 'su cédula, RIF y demás documentos' : 'el packing list y las fotos'}.</span></div>`);
    };
  }

  enganchar('clientModal', 'cliente');
  enganchar('labelModal', 'etiqueta');
})();
