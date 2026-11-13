/**
 * Etiqueta PNG con el formato del almacén de Yiwu: la imagen que la asesora le manda al cliente para que su proveedor
 * la pegue en las cajas.
 *
 *  - Datos fijos (responsables y teléfonos, dirección, 区域, 业务): GET /api/ajustes/etiqueta-almacen; el administrador los
 *    cambia con PUT desde el mismo modal.
 *  - Datos de la etiqueta: 客服编号 = código del asesor, 客户编号 = código del cliente, 单据编号 = número de etiqueta,
 *    箱数 = cajas, 名称 = mercancía. Cajas y mercancía se pueden ajustar antes de descargar.
 *
 * Aparece como botón «Etiqueta PNG» en el detalle de la etiqueta y al editarla.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const FUENTE = '"Microsoft YaHei","PingFang SC","Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","SimHei","Heiti SC",Arial,sans-serif';
  const esAdmin = () => me()?.role === 'admin';
  let fijos = null;

  async function datosFijos(forzar = false) {
    if (!fijos || forzar) fijos = await api('/api/ajustes/etiqueta-almacen');
    return fijos;
  }

  /** Datos variables de la etiqueta, sacados de lo que ya tiene el panel. */
  function datosEtiqueta(l) {
    const cliente = db.clients.find((c) => String(c.id) === String(l.clientId)) || {};
    const asesorId = l.advisorId || cliente.advisorId;
    const asesor = db.users.find((u) => String(u.id) === String(asesorId)) || {};
    const cajas = l.parentLabelId ? l.boxesPacking : (l.boxesChina || l.boxesPacking);
    return {
      asesor: asesor.advisorCode || '',
      cliente: cliente.code || '',
      numero: l.number || '',
      cajas: cajas == null ? '' : String(cajas),
      mercancia: l.cargoType || '',
    };
  }

  /** Parte un texto en líneas que caben en `ancho` (carácter a carácter: sirve para chino y para español). */
  function lineas(ctx, texto, ancho) {
    const out = [];
    for (const parrafo of String(texto || '').split('\n')) {
      let linea = '';
      for (const ch of parrafo) {
        if (ctx.measureText(linea + ch).width > ancho && linea) { out.push(linea); linea = ch.trim() ? ch : ''; } else linea += ch;
      }
      out.push(linea);
    }
    return out;
  }

  /** Escribe `texto` dentro de la caja, achicando la letra hasta que quepa (máx. `lineasMax` líneas). */
  function textoEnCaja(ctx, texto, x, y, w, h, { tam = 44, min = 18, peso = '700', lineasMax = 3, centro = true } = {}) {
    let t = tam, ls;
    for (; t >= min; t -= 2) {
      ctx.font = `${peso} ${t}px ${FUENTE}`;
      ls = lineas(ctx, texto, w - 24);
      if (ls.length <= lineasMax && ls.length * t * 1.25 <= h - 10) break;
    }
    t = Math.max(t, min);
    ctx.font = `${peso} ${t}px ${FUENTE}`;
    ls = lineas(ctx, texto, w - 24).slice(0, lineasMax);
    const alto = ls.length * t * 1.25;
    ctx.textAlign = centro ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    ls.forEach((l, i) => ctx.fillText(l, centro ? x + w / 2 : x + 12, y + (h - alto) / 2 + t * 1.25 * (i + 0.5)));
  }

  /** Dibuja la etiqueta en un canvas de 1240 × 1754 (A6 vertical a ~300 ppp, proporción de hoja). */
  function dibujar(canvas, f, v) {
    const W = 1240, H = 1754, M = 40;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';

    const filas = [];
    const resp = (f.responsables || []).map((r) => `${r.nombre} ${r.telefono}`.trim()).join('\n');
    filas.push({ k: '收货人\nRecibe', v: resp || '—', h: Math.max(150, 70 * Math.max(1, (f.responsables || []).length)), tam: 46, lineas: 6 });
    filas.push({ k: '地址\nDirección', v: f.direccion || '—', h: 200, tam: 40, lineas: 4 });
    filas.push({ k: '客服编号\nCód. asesor', v: v.asesor || '—', h: 150, tam: 84 });
    filas.push({ k: '客户编号\nCód. cliente', v: v.cliente || '—', h: 150, tam: 84 });
    filas.push({ k: '单据编号\nN.º etiqueta', v: v.numero || '—', h: 170, tam: 110 });
    filas.push({ k: '箱数\nCajas', v: v.cajas ? `${v.cajas} 箱` : '—', h: 150, tam: 84 });
    filas.push({ k: '名称\nMercancía', v: v.mercancia || '—', h: 170, tam: 60, lineas: 2 });
    filas.push({ doble: true, a: ['区域\nÁrea', f.area || '—'], b: ['业务(VE)\nNegocio', f.negocio || '—'], h: 150 });

    // Encabezado
    ctx.font = `800 64px ${FUENTE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('CRIOLLO CARGO', W / 2, M + 50);
    ctx.font = `600 34px ${FUENTE}`;
    ctx.fillText(`义乌仓库 · 委内瑞拉 (VE)${f.guias ? `   ·   票数 ${f.guias}` : ''}`, W / 2, M + 115);

    // Tabla
    const x0 = M, ancho = W - 2 * M, kw = 300;
    let y = M + 160;
    ctx.lineWidth = 5;
    const yTabla = y;
    for (const fila of filas) {
      ctx.lineWidth = 3;
      if (fila.doble) {
        const mitad = ancho / 2, kw2 = 220;
        [[fila.a, x0], [fila.b, x0 + mitad]].forEach(([[k, val], xx]) => {
          ctx.strokeRect(xx, y, kw2, fila.h); ctx.strokeRect(xx + kw2, y, mitad - kw2, fila.h);
          textoEnCaja(ctx, k, xx, y, kw2, fila.h, { tam: 34, peso: '700', lineasMax: 2 });
          textoEnCaja(ctx, val, xx + kw2, y, mitad - kw2, fila.h, { tam: 84, lineasMax: 1 });
        });
      } else {
        ctx.strokeRect(x0, y, kw, fila.h); ctx.strokeRect(x0 + kw, y, ancho - kw, fila.h);
        textoEnCaja(ctx, fila.k, x0, y, kw, fila.h, { tam: 36, peso: '700', lineasMax: 2 });
        textoEnCaja(ctx, fila.v, x0 + kw, y, ancho - kw, fila.h, { tam: fila.tam, lineasMax: fila.lineas || 1 });
      }
      y += fila.h;
    }
    ctx.lineWidth = 6; ctx.strokeRect(x0, yTabla, ancho, y - yTabla);

    // Nota del almacén
    if (f.nota) {
      ctx.fillStyle = '#000';
      textoEnCaja(ctx, f.nota, x0, y + 16, ancho, H - y - 16 - M, { tam: 34, min: 20, peso: '500', lineasMax: 5 });
    }
  }

  const nombreArchivo = (v) => `etiqueta-${String(v.numero || 'sin-numero').replace(/[^\w.-]+/g, '_')}${v.cliente ? `-${String(v.cliente).replace(/[^\w.-]+/g, '_')}` : ''}.png`;
  const aBlob = (canvas) => new Promise((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo generar la imagen'))), 'image/png'));

  async function abrir(l) {
    if (!l || l.parentLabelId) return toast('La etiqueta PNG se genera solo desde la etiqueta principal');
    let f;
    try { f = await datosFijos(); } catch (e) { return toast(e.message || 'No se pudieron leer los datos del almacén'); }
    const v = datosEtiqueta(l);
    const falta = [!v.asesor && 'código del asesor', !v.cliente && 'código del cliente'].filter(Boolean);
    openModal(`Etiqueta PNG · ${esc(v.numero)}`, `
      <p class="fx-muted" style="margin-top:0">Imagen para mandarle al cliente: su proveedor la imprime y la pega en cada caja.${falta.length ? ` <b>Falta el ${falta.join(' y el ')}</b>: complétalo en el usuario o el cliente.` : ''}</p>
      <div class="fx-grid">
        <div class="field"><label for="epCajas">箱数 · Cajas</label><input id="epCajas" type="number" min="0" step="1" value="${esc(v.cajas)}"></div>
        <div class="field"><label for="epMerc">名称 · Mercancía</label><input id="epMerc" maxlength="80" value="${esc(v.mercancia)}" placeholder="Ej.: 衣服 / Ropa"></div>
      </div>
      <div style="text-align:center;margin-top:10px"><canvas id="epLienzo" style="max-width:100%;max-height:60vh;border:1px solid #ccc;background:#fff"></canvas></div>
      ${esAdmin() ? '<div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="epFijos" type="button">Datos fijos del almacén…</button></div>' : ''}`,
      `<button class="btn btn-secondary" id="modalCancel">Cerrar</button>${navigator.canShare ? '<button class="btn btn-secondary" id="epCompartir">Compartir</button>' : ''}<button class="btn btn-primary" id="epBajar">Descargar PNG</button>`);
    $('modalCancel').onclick = closeModal;
    const pintar = () => { v.cajas = $('epCajas').value.trim(); v.mercancia = $('epMerc').value.trim(); dibujar($('epLienzo'), f, v); };
    $('epCajas').oninput = pintar; $('epMerc').oninput = pintar;
    if (document.fonts?.ready) await document.fonts.ready;
    pintar();
    $('epBajar').onclick = async () => {
      try {
        const url = URL.createObjectURL(await aBlob($('epLienzo')));
        const a = document.createElement('a'); a.href = url; a.download = nombreArchivo(v);
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { toast(e.message); }
    };
    $('epCompartir')?.addEventListener('click', async () => {
      try {
        const archivo = new File([await aBlob($('epLienzo'))], nombreArchivo(v), { type: 'image/png' });
        if (!navigator.canShare({ files: [archivo] })) return toast('Este navegador no permite compartir imágenes; usa «Descargar PNG».');
        await navigator.share({ files: [archivo], title: `Etiqueta ${v.numero}` });
      } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
    });
    $('epFijos')?.addEventListener('click', () => editarFijos(l));
  }

  function editarFijos(l) {
    const f = fijos || {};
    const resp = (f.responsables || []).map((r) => `${r.nombre} ${r.telefono}`.trim()).join('\n');
    openModal('Datos fijos de la etiqueta del almacén', `
      <p class="fx-muted" style="margin-top:0">Salen en todas las etiquetas PNG.</p>
      <div class="field"><label for="efResp">收货人 · Responsables (uno por línea: nombre y teléfono)</label><textarea id="efResp" rows="4">${esc(resp)}</textarea></div>
      <div class="field"><label for="efDir">地址 · Dirección del almacén</label><textarea id="efDir" rows="2" maxlength="300">${esc(f.direccion || '')}</textarea></div>
      <div class="fx-grid">
        <div class="field"><label for="efArea">区域 · Área</label><input id="efArea" maxlength="30" value="${esc(f.area || '')}"></div>
        <div class="field"><label for="efNeg">业务(VE) · Negocio</label><input id="efNeg" maxlength="30" value="${esc(f.negocio || '')}"></div>
        <div class="field"><label for="efGuias">票数 · Guías</label><input id="efGuias" maxlength="10" value="${esc(f.guias || '')}"></div>
      </div>
      <div class="field"><label for="efNota">Nota al pie</label><textarea id="efNota" rows="3" maxlength="400">${esc(f.nota || '')}</textarea></div>`,
      '<button class="btn btn-secondary" id="modalCancel">Volver</button><button class="btn btn-primary" id="efGuardar">Guardar</button>');
    $('modalCancel').onclick = () => abrir(l);
    $('efGuardar').onclick = async () => {
      const responsables = $('efResp').value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => {
        const m = x.match(/^(.*?)[\s:：,，]*([+\d][\d\s-]{5,})$/);
        return m ? { nombre: m[1].trim(), telefono: m[2].replace(/\s+/g, '') } : { nombre: x, telefono: '' };
      });
      try {
        fijos = await api('/api/ajustes/etiqueta-almacen', { method: 'PUT', body: JSON.stringify({ responsables, direccion: $('efDir').value, area: $('efArea').value, negocio: $('efNeg').value, guias: $('efGuias').value, nota: $('efNota').value }) });
        toast('Datos del almacén guardados');
        abrir(l);
      } catch (e) { toast(e.message); }
    };
  }

  function botonEn(l) {
    const pie = document.querySelector('#modal .modal-foot');
    // Solo etiquetas principales: las subetiquetas no llevan su propia etiqueta PNG.
    if (!pie || !l || l.parentLabelId || $('epAbrir')) return;
    pie.insertAdjacentHTML('afterbegin', '<button class="btn btn-secondary" id="epAbrir" type="button">Etiqueta PNG</button>');
    $('epAbrir').onclick = () => abrir(l);
  }

  // Detalle de la etiqueta
  const accionOriginal = window.handleAction;
  window.handleAction = function (action, id) {
    const r = accionOriginal.apply(this, arguments);
    if (action === 'label-view') botonEn(db.labels.find((x) => x.id === id));
    return r;
  };
  // Editar etiqueta
  const modalOriginal = window.labelModal;
  window.labelModal = function (existing = null) {
    const r = modalOriginal.apply(this, arguments);
    if (existing) botonEn(existing);
    return r;
  };

  window.EtiquetaPNG = { abrir, dibujar };
})();
