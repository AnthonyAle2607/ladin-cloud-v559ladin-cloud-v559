/**
 * Panel: web pública y tienda en preventa (solo administrador). Usa la API de web-publica.js y tienda.js.
 *  - Menú «Web y tienda»: Productos, Pedidos y Solicitudes.
 *  - Ficha del contenedor: «Publicar en la web» (tablero de zarpes: cierre, capacidad y ruta).
 * Se carga después de app.js y facturacion.js y usa sus funciones globales (api, esc, openModal, field, toast…).
 */
(function () {
  'use strict';

  const isAdmin = () => me()?.role === 'admin';
  const page = () => document.getElementById('page');
  const $ = (id) => document.getElementById(id);
  const usd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const cargando = (t) => `<div class="page-head"><div><h1>${esc(t)}</h1><p>Cargando…</p></div></div>`;
  const fallo = (t, e) => `<div class="page-head"><div><h1>${esc(t)}</h1></div></div><div class="card section"><div class="empty">${esc(e?.message || 'No se pudo cargar')}</div></div>`;
  const wa = (tel, texto = '') => { const n = String(tel || '').replace(/\D/g, ''); return n ? `https://wa.me/${n.startsWith('0') ? '58' + n.slice(1) : n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}` : ''; };

  const ESTADO_PEDIDO = { pendiente_pago: ['Pendiente de pago', 'pendiente'], pago_reportado: ['Pago reportado', 'parcial'], pagado: ['Pagado', 'pagada'], en_camino: ['En camino', 'generada'], entregado: ['Entregado', 'pagada'], cancelado: ['Cancelado', 'anulada'], vencido: ['Vencido', 'anulada'] };
  const ACCION = { pago_reportado: 'Marcar pago reportado', pendiente_pago: 'Volver a pendiente', pagado: 'Confirmar pago', en_camino: 'Marcar en camino', entregado: 'Marcar entregado', cancelado: 'Cancelar' };
  const pillPedido = (s) => `<span class="fx-pill ${ESTADO_PEDIDO[s]?.[1] || ''}">${esc(ESTADO_PEDIDO[s]?.[0] || s)}</span>`;
  const TIPO_SOLICITUD = { reserva: 'Reservar espacio', contacto: 'Contacto', aviso_producto: 'Avísame (tienda)' };

  /** Pide un archivo protegido (fotos) con la sesión y devuelve una URL local. */
  async function urlBlob(ruta) {
    const r = await fetch(ruta, { headers: { Authorization: `Bearer ${session.token}` }, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return URL.createObjectURL(await r.blob());
  }

  /* =====================================================================================================
     Menú y vistas
     ===================================================================================================== */

  const VISTAS = { webProductos: mostrarProductos, webPedidos: mostrarPedidos, webSolicitudes: mostrarSolicitudes };

  const shellOriginal = window.shellHTML;
  window.shellHTML = function () {
    const html = shellOriginal();
    if (!isAdmin()) return html;
    const btn = (v, t) => `<button data-view="${v}" title="${t}"><span class="nav-label">${t}</span></button>`;
    return html.replace('</nav>', `<div class="nav-group"><div class="nav-divider"><span class="nav-label">Web y tienda</span></div>${btn('webProductos', 'Productos')}${btn('webPedidos', 'Pedidos web')}${btn('webSolicitudes', 'Solicitudes web')}</div></nav>`);
  };

  const renderOriginal = window.renderView;
  window.renderView = function () {
    const vista = VISTAS[currentView];
    if (!vista) return renderOriginal();
    if (!isAdmin()) { currentView = 'dashboard'; return renderOriginal(); }
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === currentView));
    if (page()) vista();
  };

  const sigueEn = (vista) => currentView === vista && page();

  /* =====================================================================================================
     Contenedor: publicar en la web
     ===================================================================================================== */

  const containerModalOriginal = window.containerModal;
  window.containerModal = function (existing = null) {
    containerModalOriginal(existing);
    if (!existing || !isAdmin()) return;
    const cuerpo = document.querySelector('#modal .modal-body');
    if (!cuerpo) return;
    const w = existing.web || { publish: false, closing: '', capacityCbm: 68, route: '' };
    cuerpo.insertAdjacentHTML('beforeend', `<div class="fx-box" style="margin-top:14px"><h3>Publicar en la web</h3>
      <p class="fx-muted" style="margin:0 0 8px">Sale en el tablero de zarpes de la web con su fecha de cierre, llegada estimada y ocupación (calculada con el CBM de sus etiquetas). Los productos de la tienda que viajan en él muestran su llegada.</p>
      <label class="wt-check"><input type="checkbox" id="wtPublicar" ${w.publish ? 'checked' : ''}> Mostrar en la web</label>
      <div class="fx-grid">${field('wtCierre', 'Cierre de carga en Yiwu', w.closing || '', 'date')}${field('wtCapacidad', 'Capacidad (m³)', String(w.capacityCbm ?? 68), 'number', 'min="1" max="100" step="0.1"')}${field('wtRuta', 'Ruta', w.route || '', 'text', 'maxlength="120" placeholder="Yiwu → Puerto Cabello"')}</div>
      <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="wtGuardarWeb" type="button">Guardar publicación</button></div></div>`);
    $('wtGuardarWeb').onclick = async () => {
      const datos = { publicar: $('wtPublicar').checked, cierre: $('wtCierre').value, capacidadCbm: $('wtCapacidad').value, ruta: $('wtRuta').value.trim() };
      try {
        await api(`/api/contenedores/${encodeURIComponent(existing.id)}/web`, { method: 'PUT', body: JSON.stringify(datos) });
        const nuevo = { publish: datos.publicar, closing: datos.cierre, capacityCbm: Number(datos.capacidadCbm) || 68, route: datos.ruta };
        existing.web = nuevo;
        const c = db.containers.find((x) => x.id === existing.id); if (c) c.web = nuevo;
        toast(datos.publicar ? 'Contenedor publicado en la web' : 'Contenedor retirado de la web');
      } catch (e) { toast(e.message); }
    };
  };

  /* =====================================================================================================
     Productos
     ===================================================================================================== */

  let productos = [];
  let categorias = [];
  let filtroProd = '';
  let filtroCat = '';

  async function mostrarProductos() {
    page().innerHTML = cargando('Productos de la tienda');
    try { [productos, categorias] = await Promise.all([api('/api/tienda/admin/productos'), api('/api/tienda/admin/categorias')]); }
    catch (e) { if (sigueEn('webProductos')) page().innerHTML = fallo('Productos de la tienda', e); return; }
    if (!sigueEn('webProductos')) return;
    const publicados = productos.filter((p) => p.activo);
    const sinCupo = publicados.filter((p) => !p.variantes.some((v) => v.activa && v.cupo > 0));
    page().innerHTML = `
      <div class="page-head"><div><h1>Productos de la tienda</h1><p>Preventa de la web: cada producto viaja en un contenedor y tiene un cupo por variante.</p></div>
        <div class="row"><button class="btn btn-secondary" id="wtCategorias">Categorías</button><button class="btn btn-secondary" id="wtDestinos">Destinos</button><button class="btn btn-secondary" id="wtImportar">Importar desde 1688</button><button class="btn btn-primary" id="wtNuevo">Nuevo producto</button></div></div>
      <div class="fx-kpis">
        <div class="fx-kpi"><span>Publicados</span><b>${publicados.length}</b><small>de ${productos.length} producto(s)</small></div>
        <div class="fx-kpi"><span>Agotados</span><b>${sinCupo.length}</b><small>publicados sin cupo</small></div>
        <div class="fx-kpi"><span>Categorías</span><b>${categorias.filter((c) => c.activa).length}</b></div>
      </div>
      <div class="fx-toolbar">
        <input type="search" id="wtBuscar" placeholder="Buscar por nombre o contenedor" value="${esc(filtroProd)}" aria-label="Buscar productos">
        <select id="wtCat" aria-label="Categoría"><option value="">Todas las categorías</option>${categorias.map((c) => `<option value="${esc(c.id)}" ${filtroCat === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
      </div>
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Producto</th><th>Categoría</th><th>Contenedor</th><th class="fx-num">Precio</th><th class="fx-num">Cupo</th><th>Web</th><th></th></tr></thead><tbody id="wtFilas"></tbody></table></div></div>`;
    pintarProductos();
    $('wtBuscar').oninput = (e) => { filtroProd = e.target.value; pintarProductos(); };
    $('wtCat').onchange = (e) => { filtroCat = e.target.value; pintarProductos(); };
    $('wtNuevo').onclick = () => productoModal();
    $('wtImportar').onclick = importarModal;
    $('wtCategorias').onclick = categoriasModal;
    $('wtDestinos').onclick = destinosModal;
  }

  function pintarProductos() {
    const q = filtroProd.trim().toLowerCase();
    const cat = (id) => categorias.find((c) => c.id === id)?.nombre || '—';
    const filas = productos.filter((p) => (!filtroCat || p.categoriaId === filtroCat) && (!q || `${p.nombre} ${p.contenedor}`.toLowerCase().includes(q)));
    $('wtFilas').innerHTML = filas.length
      ? filas.map((p) => {
          const cupo = p.variantes.filter((v) => v.activa).reduce((s, v) => s + v.cupo, 0);
          return `<tr><td><b>${esc(p.nombre)}</b><br><small class="fx-muted">/${esc(p.slug)} · ${p.variantes.filter((v) => v.activa).length} variante(s) · ${p.imagenes.length} foto(s)</small></td>
            <td>${esc(cat(p.categoriaId))}</td><td>${p.contenedor ? `<span class="code-pill">${esc(p.contenedor)}</span>` : '<span class="fx-warn">Sin contenedor</span>'}</td>
            <td class="fx-num">${usd(p.precioUsd)}${p.precioAntesUsd ? `<br><small class="fx-muted"><s>${usd(p.precioAntesUsd)}</s></small>` : ''}</td>
            <td class="fx-num">${cupo || '<span class="fx-bad">0</span>'}</td>
            <td>${p.activo ? '<span class="fx-pill pagada">Publicado</span>' : '<span class="fx-pill anulada">Oculto</span>'}</td>
            <td><div class="fx-table-actions"><button class="btn btn-secondary btn-sm" data-wt-editar="${esc(p.id)}">Editar</button></div></td></tr>`;
        }).join('')
      : `<tr><td colspan="7"><div class="empty compact">${productos.length ? 'Ningún producto coincide con el filtro.' : 'Todavía no hay productos. Crea el primero con «Nuevo producto».'}</div></td></tr>`;
    document.querySelectorAll('[data-wt-editar]').forEach((b) => (b.onclick = () => productoModal(productos.find((p) => p.id === b.dataset.wtEditar))));
  }

  function productoModal(p = null) {
    // El panel usa ids con prefijo («co5»); la API de la tienda, el número («5»).
    const idNum = (id) => String(id ?? '').replace(/^\D+/, '');
    const actual = db.containers.find((c) => idNum(c.id) === p?.contenedorId);
    const contenedores = db.containers.filter((c) => !['done', 'closed'].includes(c.status) || c === actual);
    const variantes = (p?.variantes.filter((v) => v.activa) || [{ nombre: '', sku: '', cupo: '', precioUsd: null }]).map((v) => ({ ...v }));
    openModal(p ? 'Editar producto' : 'Nuevo producto', `
      <div class="fx-grid">
        ${field('wtNombre', 'Nombre', p?.nombre || '', 'text', 'maxlength="150" required placeholder="Freidora de aire 5,5 L"')}
        ${selectField('wtCategoria', 'Categoría', [['', 'Sin categoría'], ...categorias.filter((c) => c.activa || c.id === p?.categoriaId).map((c) => [c.id, c.nombre])], p?.categoriaId || '')}
        ${field('wtOrigen', 'Origen', p?.origen || '', 'text', 'maxlength="120" placeholder="Foshan, China"')}
        ${selectField('wtContenedor', 'Viaja en el contenedor', [['', 'Sin asignar (no muestra llegada)'], ...contenedores.map((c) => [c.id, `${c.number}${c.eta ? ` · llega ${c.eta}` : ''}`])], actual?.id || '')}
        ${field('wtPrecio', 'Precio (USD)', p ? String(p.precioUsd) : '', 'number', 'min="0.01" step="0.01" required')}
        ${field('wtAntes', 'Precio anterior (opcional)', p?.precioAntesUsd != null ? String(p.precioAntesUsd) : '', 'number', 'min="0" step="0.01"')}
        ${field('wtNombreVariante', 'Nombre de la variante', p?.nombreVariante || 'Presentación', 'text', 'maxlength="40" placeholder="Color, Kit, Tamaño…"')}
        ${field('wtOrden', 'Orden en la tienda', String(p?.orden ?? 0), 'number', 'step="1"')}
        ${field('wtSlug', 'Dirección web (slug, opcional)', p?.slug || '', 'text', 'maxlength="80" placeholder="se genera con el nombre"')}
      </div>
      <div class="fx-grid" style="margin-top:10px">
        <div class="field"><label for="wtDesc">Descripción (un párrafo por línea)</label><textarea id="wtDesc" rows="4" maxlength="4000">${esc((p?.descripcion || []).join('\n'))}</textarea></div>
        <div class="field"><label for="wtSpecs">Especificaciones (una por línea)</label><textarea id="wtSpecs" rows="4" maxlength="4000">${esc((p?.especificaciones || []).join('\n'))}</textarea></div>
      </div>
      <div class="fx-box" style="margin-top:12px"><h3>Variantes y cupo</h3>
        <p class="fx-muted" style="margin:0 0 8px">El cupo son las unidades que caben en este contenedor. Cada pedido lo descuenta al reservar y lo devuelve si se cancela o vence. Si el producto no tiene variantes, deja una sola (por ejemplo «Única»).</p>
        <div class="fx-scroll"><table class="fx-lines"><thead><tr><th>Variante</th><th>SKU</th><th>Cupo</th><th>Precio propio</th><th></th></tr></thead><tbody id="wtVariantes"></tbody></table></div>
        <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="wtVarMas" type="button">+ Variante</button></div>
      </div>
      <div class="fx-box" id="wtFotos"><h3>Fotos</h3>${p ? '<span class="fx-muted">Cargando…</span>' : '<p class="fx-muted" style="margin:0">Guarda el producto y ábrelo de nuevo para subir sus fotos.</p>'}</div>
      <label class="wt-check"><input type="checkbox" id="wtActivo" ${p?.activo ? 'checked' : ''}> Publicado en la tienda</label>`,
      `<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="wtGuardar">${p ? 'Guardar cambios' : 'Crear producto'}</button>`);
    $('modalCancel').onclick = closeModal;

    const pintarVariantes = () => {
      $('wtVariantes').innerHTML = variantes.map((v, i) => `<tr>
        <td><input class="fx-desc" data-v="${i}" data-k="nombre" maxlength="80" value="${esc(v.nombre ?? '')}" placeholder="Negro" aria-label="Nombre de la variante"></td>
        <td><input data-v="${i}" data-k="sku" maxlength="60" value="${esc(v.sku ?? '')}" aria-label="SKU"></td>
        <td><input data-v="${i}" data-k="cupo" type="number" min="0" step="1" value="${esc(v.cupo ?? '')}" aria-label="Cupo"></td>
        <td><input data-v="${i}" data-k="precioUsd" type="number" min="0" step="0.01" value="${esc(v.precioUsd ?? '')}" placeholder="igual" aria-label="Precio propio"></td>
        <td><button class="btn btn-secondary btn-sm" data-quitar-v="${i}" type="button" aria-label="Quitar variante" ${variantes.length < 2 ? 'disabled' : ''}>×</button></td></tr>`).join('');
      document.querySelectorAll('#wtVariantes [data-v]').forEach((el) => (el.oninput = () => { variantes[+el.dataset.v][el.dataset.k] = el.value; }));
      document.querySelectorAll('#wtVariantes [data-quitar-v]').forEach((b) => (b.onclick = () => { variantes.splice(+b.dataset.quitarV, 1); pintarVariantes(); }));
    };
    pintarVariantes();
    $('wtVarMas').onclick = () => { variantes.push({ nombre: '', sku: '', cupo: '', precioUsd: null }); pintarVariantes(); };
    if (p) pintarFotos(p);

    $('wtGuardar').onclick = async () => {
      const cuerpo = {
        nombre: $('wtNombre').value.trim(), slug: $('wtSlug').value.trim(), categoriaId: $('wtCategoria').value, origen: $('wtOrigen').value.trim(),
        contenedorId: $('wtContenedor').value, precioUsd: $('wtPrecio').value, precioAntesUsd: $('wtAntes').value, nombreVariante: $('wtNombreVariante').value.trim(),
        orden: $('wtOrden').value, descripcion: $('wtDesc').value, especificaciones: $('wtSpecs').value, activo: $('wtActivo').checked,
        variantes: variantes.map((v) => ({ id: v.id, nombre: String(v.nombre || '').trim(), sku: String(v.sku || '').trim(), cupo: v.cupo === '' ? NaN : Number(v.cupo), precioUsd: v.precioUsd === '' ? null : v.precioUsd })),
      };
      if (cuerpo.activo && !cuerpo.contenedorId && !confirm('El producto no tiene contenedor: la web no podrá mostrar su fecha de llegada. ¿Publicarlo igual?')) return;
      try {
        const r = await api(p ? `/api/tienda/admin/productos/${encodeURIComponent(p.id)}` : '/api/tienda/admin/productos', { method: p ? 'PUT' : 'POST', body: JSON.stringify(cuerpo) });
        toast(p ? 'Producto guardado' : 'Producto creado: ya puedes subir sus fotos');
        await mostrarProductos();
        const actual = productos.find((x) => x.id === r.id);
        if (!p && actual) productoModal(actual); else closeModal();
      } catch (e) { toast(e.message); }
    };
  }

  async function pintarFotos(p) {
    const caja = $('wtFotos');
    if (!caja) return;
    caja.innerHTML = `<h3>Fotos</h3><p class="fx-muted" style="margin:0 0 8px">La primera es la portada. JPG, PNG o WEBP de hasta 6 MB.</p>
      <div class="wt-fotos">${p.imagenes.map((i) => `<figure class="wt-foto" data-foto="${esc(i.id)}"><span class="fx-muted">…</span><button class="btn btn-secondary btn-sm" data-borrar-foto="${esc(i.id)}" type="button" aria-label="Borrar foto">×</button></figure>`).join('') || '<span class="fx-muted">Sin fotos todavía.</span>'}</div>
      <div class="row" style="margin-top:8px"><input type="file" id="wtArchivos" accept="image/jpeg,image/png,image/webp" multiple aria-label="Fotos del producto"><button class="btn btn-secondary btn-sm" id="wtSubir" type="button">Subir fotos</button></div>`;
    for (const i of p.imagenes) {
      urlBlob(i.url).then((u) => { const f = document.querySelector(`#wtFotos [data-foto="${CSS.escape(i.id)}"] span`); if (f) f.outerHTML = `<img src="${u}" alt="">`; }).catch(() => {});
    }
    const recargar = async () => { productos = await api('/api/tienda/admin/productos'); const nuevo = productos.find((x) => x.id === p.id); if (nuevo) { Object.assign(p, nuevo); pintarFotos(p); } if (sigueEn('webProductos')) pintarProductos(); };
    $('wtSubir').onclick = async () => {
      const archivos = [...($('wtArchivos').files || [])];
      if (!archivos.length) return toast('Elige una o más fotos');
      const datos = new FormData();
      archivos.slice(0, 8).forEach((a) => datos.append('imagenes', a));
      try {
        const r = await fetch(`/api/tienda/admin/productos/${encodeURIComponent(p.id)}/imagenes`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: datos });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        toast(`${j.guardadas} foto(s) subidas`);
        await recargar();
      } catch (e) { toast(e.message); }
    };
    document.querySelectorAll('#wtFotos [data-borrar-foto]').forEach((b) => (b.onclick = async () => {
      if (!confirm('¿Borrar esta foto?')) return;
      try { await api(`/api/tienda/admin/imagenes/${encodeURIComponent(b.dataset.borrarFoto)}`, { method: 'DELETE' }); await recargar(); } catch (e) { toast(e.message); }
    }));
  }

  /* ---------- Importar desde 1688 (importador-1688.js) ---------- */

  async function importarModal() {
    let estado;
    try { estado = await api('/api/tienda/admin/importar/estado'); } catch (e) { return toast(e.message); }
    openModal('Importar producto desde 1688', `
      <p class="fx-muted" style="margin:0 0 10px">Arma un <b>borrador sin publicar</b> con el nombre y la descripción traducidos y un precio sugerido. Tú lo revisas, pones el cupo y el contenedor, y lo publicas.</p>
      ${estado.ia ? '' : '<p class="fx-bad">La IA no está configurada en el servidor (IA_PROVEEDOR e IA_API_KEY): el importador no puede leer productos.</p>'}
      <div class="fx-grid">${field('wtImpUrl', 'Enlace del producto (1688, Taobao, Yiwugo…)', '', 'url', 'placeholder="https://detail.1688.com/offer/…html"')}${field('wtImpCantidad', 'Cantidad que piensas comprar', '100', 'number', 'min="1" step="1" title="Elige el precio por cantidad que aplica"')}</div>
      <p class="fx-muted" style="margin:6px 0 10px">${estado.api ? 'Con el enlace basta: el servidor consulta la API del proveedor de datos.' : 'Aún no hay API de un proveedor de datos: el enlace se guarda como referencia. Sube <b>capturas</b> de la página (precio por cantidad, variantes y la tabla de la caja, 装箱) o <b>pega el texto</b> de la página.'}</p>
      <div class="fx-grid">
        <div class="field"><label for="wtImpCapturas">Capturas de la página (hasta 4)</label><input type="file" id="wtImpCapturas" accept="image/jpeg,image/png,image/webp" multiple></div>
        <div class="field"><label for="wtImpTexto">Texto copiado de la página (opcional)</label><textarea id="wtImpTexto" rows="4" maxlength="40000" placeholder="Ctrl+A y Ctrl+C en la página del producto, y pega aquí"></textarea></div>
      </div>
      <div id="wtImpResultado"></div>`,
      `<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="wtImpLeer" ${estado.ia ? '' : 'disabled'}>Leer producto</button>`);
    $('modalCancel').onclick = closeModal;
    $('wtImpLeer').onclick = async () => {
      const datos = new FormData();
      const url = $('wtImpUrl').value.trim();
      const texto = $('wtImpTexto').value.trim();
      const capturas = [...($('wtImpCapturas').files || [])].slice(0, 4);
      if (!url && !texto && !capturas.length) return toast('Sube capturas, pega el texto o indica el enlace');
      if (url) datos.append('url', url);
      if (texto) datos.append('texto', texto);
      datos.append('cantidad', $('wtImpCantidad').value || '100');
      capturas.forEach((c) => datos.append('capturas', c));
      const boton = $('wtImpLeer');
      boton.disabled = true; boton.textContent = 'Leyendo… (hasta 30 s)';
      $('wtImpResultado').innerHTML = '';
      try {
        const r = await fetch('/api/tienda/admin/importar', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: datos });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        mostrarImportado(j, url);
      } catch (e) { $('wtImpResultado').innerHTML = `<p class="fx-bad">${esc(e.message)}</p>`; }
      finally { boton.disabled = false; boton.textContent = 'Leer de nuevo'; }
    };
  }

  function mostrarImportado({ datos: d, sugerido, avisos }, urlPegada) {
    const cny = (n) => (n != null ? `${d.moneda === 'USD' ? 'US$' : '¥'}${Number(n).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : '—');
    const mu = d.medidasUnidad || {};
    const p = d.paquete || {};
    const categoria = categorias.find((c) => c.activa && c.nombre.toLowerCase() === String(d.categoriaSugerida || '').toLowerCase());
    const contenedores = db.containers.filter((c) => !['done', 'closed'].includes(c.status));
    const g = sugerido?.desglose;
    $('wtImpResultado').innerHTML = `<div class="fx-box" style="margin-top:12px"><h3>Borrador</h3>
      ${(avisos || []).map((a) => `<p class="fx-warn" style="margin:0 0 6px">⚠ ${esc(a)}</p>`).join('')}
      <div class="fx-grid">
        ${field('wtImpNombre', 'Nombre en la tienda', d.nombre || '', 'text', 'maxlength="150"')}
        ${selectField('wtImpCategoria', 'Categoría', [['', d.categoriaSugerida ? `Sin categoría (sugerida: ${d.categoriaSugerida})` : 'Sin categoría'], ...categorias.filter((c) => c.activa).map((c) => [c.id, c.nombre])], categoria?.id || '')}
        ${selectField('wtImpContenedor', 'Viaja en el contenedor', [['', 'Sin asignar'], ...contenedores.map((c) => [c.id, `${c.number}${c.eta ? ` · llega ${c.eta}` : ''}`])], '')}
        ${field('wtImpPrecio', 'Precio de venta (USD)', sugerido ? String(sugerido.precioUsd) : '', 'number', 'min="0.01" step="0.01"')}
      </div>
      <p class="fx-muted" style="margin:8px 0">${esc(d.nombreOriginal || '')}${d.proveedor ? ` · <b>${esc(d.proveedor)}</b>` : ''}${d.origen ? ` · ${esc(d.origen)}` : ''}</p>
      <div class="fx-grid">
        <div><b>Precios en origen</b><br>${d.precios.map((t) => `desde ${t.desdeUnidades} ${esc(d.unidad || 'u.')}: ${cny(t.precio)}`).join('<br>') || '—'}</div>
        <div><b>Empaque</b><br>Caja: ${p.largoCm ? `${p.largoCm}×${p.anchoCm}×${p.altoCm} cm` : 'sin medidas'}${p.unidadesPorCaja ? ` · ${p.unidadesPorCaja} u.` : ''}${p.pesoKg ? ` · ${p.pesoKg} kg` : ''}${mu.largoCm ? `<br>Unidad: ${mu.largoCm}×${mu.anchoCm}×${mu.altoCm} cm${mu.pesoKg ? ` · ${mu.pesoKg} kg` : ''}` : ''}</div>
        <div><b>Precio sugerido</b> (comprando ${sugerido?.cantidad ?? '—'}, tramo desde ${sugerido?.tramoDesde ?? '—'})<br>${g ? `${cny(g.precioOrigen)}${g.tasa ? ` ÷ ${g.tasa}` : ''} = $${g.costoUsd} · envío China $${g.envioChinaUsd} · flete ${g.fleteUsd != null ? `$${g.fleteUsd} (${g.fleteSegun === 'caja' ? 'por caja' : 'aprox. por unidad'})` : 'sin datos'} · margen ${g.margenPct}% → <b>$${sugerido.precioUsd}</b>` : '—'}</div>
      </div>
      ${d.variantes.length ? `<p style="margin:10px 0 4px"><b>${esc(d.nombreVariante || 'Variantes')}:</b> ${d.variantes.map((v) => esc(v.nombre) + (v.precioSugeridoUsd ? ` ($${v.precioSugeridoUsd})` : '')).join(' · ')}</p>` : ''}
      ${d.descripcion.length ? `<p class="fx-muted" style="margin:6px 0">${d.descripcion.map(esc).join('<br>')}</p>` : ''}
      ${d.especificaciones.length ? `<p class="fx-muted" style="margin:6px 0">${d.especificaciones.map(esc).join(' · ')}</p>` : ''}
      <p class="fx-muted" style="margin:6px 0">${d.imagenes.length} foto(s) del proveedor${d.imagenes.length ? ': se intentarán traer al borrador' : ''}.</p>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="wtImpCrear" type="button">Crear borrador</button></div></div>`;
    $('wtImpCrear').onclick = async () => {
      const boton = $('wtImpCrear');
      const nombre = $('wtImpNombre').value.trim();
      const precio = Number($('wtImpPrecio').value);
      if (!nombre) return toast('Escribe el nombre');
      if (!(precio > 0)) return toast('Indica el precio de venta');
      boton.disabled = true; boton.textContent = 'Creando…';
      try {
        const r = await api('/api/tienda/admin/productos', { method: 'POST', body: JSON.stringify({
          nombre, categoriaId: $('wtImpCategoria').value, contenedorId: $('wtImpContenedor').value, origen: d.origen || '',
          precioUsd: precio, nombreVariante: d.nombreVariante || 'Presentación', descripcion: d.descripcion, especificaciones: d.especificaciones, activo: false,
          // El cupo lo decide el equipo: el borrador nace en 0 y sin publicar.
          variantes: d.variantes.length ? d.variantes.map((v) => ({ nombre: v.nombre, cupo: 0, precioUsd: v.precioSugeridoUsd || null })) : [{ nombre: 'Única', cupo: 0 }],
          fuenteUrl: d.url || urlPegada || '',
          costoReferencia: { proveedor: d.proveedor, moneda: d.moneda, precios: d.precios, paquete: d.paquete, medidasUnidad: d.medidasUnidad, desglose: sugerido?.desglose || null, pedidoMinimo: d.pedidoMinimo, nombreOriginal: d.nombreOriginal },
        }) });
        let fotosTexto = '';
        if (d.imagenes.length) {
          try { const f = await api(`/api/tienda/admin/productos/${encodeURIComponent(r.id)}/imagenes-remotas`, { method: 'POST', body: JSON.stringify({ urls: d.imagenes }) }); fotosTexto = ` y ${f.guardadas} de ${f.pedidas} foto(s)`; } catch (_) { fotosTexto = ' (las fotos no se pudieron traer)'; }
        }
        toast(`Borrador creado${fotosTexto}. Revisa, pon el cupo y publícalo.`);
        await mostrarProductos();
        const nuevo = productos.find((x) => x.id === r.id);
        if (nuevo) productoModal(nuevo); else closeModal();
      } catch (e) { toast(e.message); boton.disabled = false; boton.textContent = 'Crear borrador'; }
    };
  }

  function categoriasModal() {
    const filas = categorias.map((c) => ({ ...c }));
    openModal('Categorías de la tienda', `<p class="fx-muted" style="margin:0 0 8px">Aparecen como filtros en la tienda y en el inicio de la web, en este orden.</p>
      <div class="fx-scroll"><table class="fx-lines"><thead><tr><th>Nombre</th><th>Orden</th><th>Visible</th></tr></thead><tbody id="wtCatFilas"></tbody></table></div>
      <div class="fx-grid" style="margin-top:12px">${field('wtCatNueva', 'Nueva categoría', '', 'text', 'maxlength="80" placeholder="Ferretería"')}</div>`,
      '<button class="btn btn-secondary" id="modalCancel">Cerrar</button><button class="btn btn-secondary" id="wtCatAgregar">Agregar</button><button class="btn btn-primary" id="wtCatGuardar">Guardar cambios</button>');
    $('modalCancel').onclick = closeModal;
    $('wtCatFilas').innerHTML = filas.map((c, i) => `<tr><td><input class="fx-desc" data-c="${i}" data-k="nombre" maxlength="80" value="${esc(c.nombre)}" aria-label="Nombre"></td><td><input data-c="${i}" data-k="orden" type="number" step="1" value="${esc(c.orden)}" aria-label="Orden"></td><td><input data-c="${i}" data-k="activa" type="checkbox" ${c.activa ? 'checked' : ''} aria-label="Visible"></td></tr>`).join('') || '<tr><td colspan="3"><span class="fx-muted">Sin categorías.</span></td></tr>';
    document.querySelectorAll('#wtCatFilas [data-c]').forEach((el) => (el.oninput = el.onchange = () => { filas[+el.dataset.c][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }));
    $('wtCatAgregar').onclick = async () => {
      const nombre = $('wtCatNueva').value.trim();
      if (!nombre) return toast('Escribe el nombre de la categoría');
      try { await api('/api/tienda/admin/categorias', { method: 'POST', body: JSON.stringify({ nombre, orden: filas.length }) }); categorias = await api('/api/tienda/admin/categorias'); toast('Categoría creada'); categoriasModal(); } catch (e) { toast(e.message); }
    };
    $('wtCatGuardar').onclick = async () => {
      try {
        const cambiadas = filas.filter((c) => { const o = categorias.find((x) => x.id === c.id); return o && (o.nombre !== c.nombre || String(o.orden) !== String(c.orden) || o.activa !== c.activa); });
        for (const c of cambiadas) await api(`/api/tienda/admin/categorias/${encodeURIComponent(c.id)}`, { method: 'PUT', body: JSON.stringify({ nombre: String(c.nombre).trim(), orden: Number(c.orden) || 0, activa: c.activa }) });
        toast(cambiadas.length ? 'Categorías guardadas' : 'Sin cambios');
        closeModal(); if (sigueEn('webProductos')) mostrarProductos();
      } catch (e) { toast(e.message); }
    };
  }

  async function destinosModal() {
    let destinos;
    try { destinos = await api('/api/tienda/destinos'); } catch (e) { return toast(e.message); }
    const filas = destinos.map((d) => ({ ...d }));
    const pintar = () => {
      $('wtDestFilas').innerHTML = filas.map((d, i) => `<tr><td><input class="fx-desc" data-d="${i}" data-k="nombre" maxlength="80" value="${esc(d.nombre)}" aria-label="Destino"></td>
        <td><input data-d="${i}" data-k="costoUsd" type="number" min="0" step="0.01" value="${esc(d.costoUsd)}" aria-label="Costo"></td>
        <td><input data-d="${i}" data-k="diasExtra" type="number" min="0" step="1" value="${esc(d.diasExtra)}" aria-label="Días extra"></td>
        <td><input data-d="${i}" data-k="requiereDireccion" type="checkbox" ${d.requiereDireccion ? 'checked' : ''} aria-label="Pide dirección"></td>
        <td><button class="btn btn-secondary btn-sm" data-quitar-d="${i}" type="button" aria-label="Quitar destino" ${filas.length < 2 ? 'disabled' : ''}>×</button></td></tr>`).join('');
      document.querySelectorAll('#wtDestFilas [data-d]').forEach((el) => (el.oninput = el.onchange = () => { filas[+el.dataset.d][el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; }));
      document.querySelectorAll('#wtDestFilas [data-quitar-d]').forEach((b) => (b.onclick = () => { filas.splice(+b.dataset.quitarD, 1); pintar(); }));
    };
    openModal('Destinos de entrega', `<p class="fx-muted" style="margin:0 0 8px">Lo que elige el cliente al comprar: costo del traslado desde Valencia y días que suma a la llegada del contenedor. Los pedidos ya hechos guardan el destino y el costo que tenían.</p>
      <div class="fx-scroll"><table class="fx-lines"><thead><tr><th>Destino</th><th>Costo (USD)</th><th>Días extra</th><th>Pide dirección</th><th></th></tr></thead><tbody id="wtDestFilas"></tbody></table></div>
      <div class="row" style="margin-top:8px"><button class="btn btn-secondary btn-sm" id="wtDestMas" type="button">+ Destino</button></div>`,
      '<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="wtDestGuardar">Guardar destinos</button>');
    $('modalCancel').onclick = closeModal;
    pintar();
    $('wtDestMas').onclick = () => { filas.push({ nombre: '', costoUsd: 0, diasExtra: 0, requiereDireccion: true }); pintar(); };
    $('wtDestGuardar').onclick = async () => {
      try {
        await api('/api/tienda/admin/destinos', { method: 'PUT', body: JSON.stringify({ destinos: filas.map((d) => ({ id: d.id, nombre: String(d.nombre).trim(), costoUsd: Number(d.costoUsd), diasExtra: Number(d.diasExtra), requiereDireccion: !!d.requiereDireccion })) }) });
        toast('Destinos guardados'); closeModal();
      } catch (e) { toast(e.message); }
    };
  }

  /* =====================================================================================================
     Pedidos de la web
     ===================================================================================================== */

  let pedidos = [];
  let filtroPedido = '';
  let estadoPedido = '';

  async function mostrarPedidos() {
    page().innerHTML = cargando('Pedidos de la web');
    try { pedidos = await api('/api/tienda/admin/pedidos'); } catch (e) { if (sigueEn('webPedidos')) page().innerHTML = fallo('Pedidos de la web', e); return; }
    if (!sigueEn('webPedidos')) return;
    const cuenta = (...es) => pedidos.filter((p) => es.includes(p.estado)).length;
    const vendido = pedidos.filter((p) => ['pagado', 'en_camino', 'entregado'].includes(p.estado)).reduce((s, p) => s + p.totalUsd, 0);
    page().innerHTML = `
      <div class="page-head"><div><h1>Pedidos de la web</h1><p>Pedidos de la tienda en preventa. Confirma el pago cuando verifiques la referencia; al cancelar, el cupo vuelve a la tienda.</p></div></div>
      <div class="fx-kpis">
        <div class="fx-kpi"><span>Por verificar</span><b>${cuenta('pago_reportado')}</b><small>pago reportado por el cliente</small></div>
        <div class="fx-kpi"><span>Pendientes de pago</span><b>${cuenta('pendiente_pago')}</b><small>con cupo reservado</small></div>
        <div class="fx-kpi"><span>Vendido</span><b>${usd(vendido)}</b><small>pagados, en camino y entregados</small></div>
      </div>
      <div class="fx-toolbar">
        <input type="search" id="wtPedBuscar" placeholder="Buscar por número, nombre, teléfono o referencia" value="${esc(filtroPedido)}" aria-label="Buscar pedidos">
        <select id="wtPedEstado" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(ESTADO_PEDIDO).map(([k, v]) => `<option value="${k}" ${estadoPedido === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      </div>
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th>Pedido</th><th>Fecha</th><th>Cliente</th><th>Entrega</th><th class="fx-num">Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody id="wtPedFilas"></tbody></table></div></div>`;
    pintarPedidos();
    $('wtPedBuscar').oninput = (e) => { filtroPedido = e.target.value; pintarPedidos(); };
    $('wtPedEstado').onchange = (e) => { estadoPedido = e.target.value; pintarPedidos(); };
  }

  function pintarPedidos() {
    const q = filtroPedido.trim().toLowerCase();
    const filas = pedidos.filter((p) => (!estadoPedido || p.estado === estadoPedido) && (!q || [p.numero, p.nombre, p.telefono, p.referenciaPago, p.email].join(' ').toLowerCase().includes(q)));
    $('wtPedFilas').innerHTML = filas.length
      ? filas.map((p) => `<tr><td><span class="code-pill">${esc(p.numero)}</span><br><small class="fx-muted">${p.items.reduce((s, i) => s + i.cantidad, 0)} unidad(es)</small></td>
          <td>${esc(cuando(p.creadoEn))}</td>
          <td><b>${esc(p.nombre)}</b><br><small class="fx-muted">${esc(p.telefono)}</small></td>
          <td>${esc(p.destino || '—')}</td><td class="fx-num">${usd(p.totalUsd)}</td>
          <td>${esc(p.metodoPago || '—')}${p.referenciaPago ? `<br><small class="fx-muted">Ref. ${esc(p.referenciaPago)}</small>` : ''}</td>
          <td>${pillPedido(p.estado)}${p.estado === 'pendiente_pago' && p.venceEn ? `<br><small class="fx-muted">Vence ${esc(cuando(p.venceEn))}</small>` : ''}</td>
          <td><div class="fx-table-actions"><button class="btn btn-secondary btn-sm" data-wt-pedido="${esc(p.id)}">Ver</button></div></td></tr>`).join('')
      : `<tr><td colspan="8"><div class="empty compact">${pedidos.length ? 'Ningún pedido coincide con el filtro.' : 'Todavía no hay pedidos de la web.'}</div></td></tr>`;
    document.querySelectorAll('[data-wt-pedido]').forEach((b) => (b.onclick = () => pedidoModal(pedidos.find((p) => p.id === b.dataset.wtPedido))));
  }

  function pedidoModal(p) {
    const contenedor = (id) => db.containers.find((c) => String(c.id).replace(/^\D+/, '') === String(id))?.number || '';
    const link = wa(p.telefono, `Hola ${p.nombre}, te escribimos de Criollo Cargo por tu pedido ${p.numero}.`);
    openModal(`Pedido ${esc(p.numero)}`, `
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">${pillPedido(p.estado)}<span class="fx-muted">${esc(cuando(p.creadoEn))}</span></div>
      <div class="fx-grid">
        <div class="fx-box"><h3>Cliente</h3><b>${esc(p.nombre)}</b><br>${esc(p.telefono)}${p.email ? `<br>${esc(p.email)}` : ''}${p.cedula ? `<br>${esc(p.cedula)}` : ''}
          ${link ? `<div style="margin-top:8px"><a class="btn btn-secondary btn-sm" href="${esc(link)}" target="_blank" rel="noopener">Escribir por WhatsApp</a></div>` : ''}</div>
        <div class="fx-box"><h3>Entrega y pago</h3>${esc(p.destino || '—')}${p.direccion ? `<br><small>${esc(p.direccion)}</small>` : ''}<br><br>${esc(p.metodoPago || '—')}
          ${p.referenciaPago ? `<br><b>Referencia: ${esc(p.referenciaPago)}</b>` : '<br><span class="fx-muted">Sin pago reportado</span>'}
          ${p.estado === 'pendiente_pago' && p.venceEn ? `<br><small class="fx-muted">La reserva vence ${esc(cuando(p.venceEn))}</small>` : ''}</div>
      </div>
      <div class="fx-scroll"><table class="table"><thead><tr><th>Producto</th><th>Contenedor</th><th class="fx-num">Cant.</th><th class="fx-num">Precio</th><th class="fx-num">Importe</th></tr></thead><tbody>
        ${p.items.map((i) => `<tr><td><b>${esc(i.nombre)}</b><br><small class="fx-muted">${esc(i.variante || '')}</small></td><td>${esc(contenedor(i.contenedorId) || '—')}</td><td class="fx-num">${i.cantidad}</td><td class="fx-num">${usd(i.precioUsd)}</td><td class="fx-num">${usd(i.precioUsd * i.cantidad)}</td></tr>`).join('')}
        <tr><td colspan="4" class="fx-num">Traslado</td><td class="fx-num">${usd(p.envioUsd)}</td></tr>
        <tr><td colspan="4" class="fx-num"><b>Total</b></td><td class="fx-num"><b>${usd(p.totalUsd)}</b></td></tr>
      </tbody></table></div>
      ${p.notas ? `<div class="fx-box"><h3>Notas</h3>${esc(p.notas)}</div>` : ''}
      ${p.siguientes.length ? `<div class="fx-grid">${field('wtNota', 'Nota interna (opcional)', '', 'text', 'maxlength="1000"')}</div>` : ''}`,
      `<button class="btn btn-secondary" id="modalCancel">Cerrar</button>${p.siguientes.map((s) => `<button class="btn ${s === 'cancelado' || s === 'pendiente_pago' ? 'btn-secondary' : 'btn-primary'}" data-wt-estado="${s}">${esc(ACCION[s] || s)}</button>`).join('')}`);
    $('modalCancel').onclick = closeModal;
    document.querySelectorAll('[data-wt-estado]').forEach((b) => (b.onclick = async () => {
      const nuevo = b.dataset.wtEstado;
      if (nuevo === 'cancelado' && !confirm(`¿Cancelar el pedido ${p.numero}? El cupo vuelve a la tienda.`)) return;
      if (nuevo === 'pagado' && !p.referenciaPago && !confirm('El cliente no ha reportado una referencia. ¿Confirmar el pago igual?')) return;
      try {
        await api(`/api/tienda/admin/pedidos/${encodeURIComponent(p.id)}/estado`, { method: 'PUT', body: JSON.stringify({ estado: nuevo, nota: $('wtNota')?.value.trim() || undefined }) });
        toast(`Pedido ${p.numero}: ${ESTADO_PEDIDO[nuevo][0].toLowerCase()}`);
        closeModal(); if (sigueEn('webPedidos')) mostrarPedidos();
      } catch (e) { toast(e.message); }
    }));
  }

  /* =====================================================================================================
     Solicitudes de la web
     ===================================================================================================== */

  let verTodas = false;

  async function mostrarSolicitudes() {
    page().innerHTML = cargando('Solicitudes de la web');
    let lista;
    try { lista = await api(`/api/web/solicitudes${verTodas ? '?todas=1' : ''}`); } catch (e) { if (sigueEn('webSolicitudes')) page().innerHTML = fallo('Solicitudes de la web', e); return; }
    if (!sigueEn('webSolicitudes')) return;
    page().innerHTML = `
      <div class="page-head"><div><h1>Solicitudes de la web</h1><p>«Reservar espacio» del cotizador, mensajes de contacto y avisos de la tienda. Escríbele al cliente y márcala como atendida.</p></div>
        <div class="row"><label class="wt-check" style="margin:0"><input type="checkbox" id="wtTodas" ${verTodas ? 'checked' : ''}> Ver también las atendidas</label></div></div>
      <div class="wt-solicitudes">${lista.map((s) => {
        const c = s.cotizacion;
        const link = wa(s.telefono, `Hola ${s.nombre}, te escribimos de Criollo Cargo por tu solicitud en la web.`);
        return `<article class="fx-box wt-sol ${s.atendida ? 'is-done' : ''}">
          <div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(s.nombre)}</b><span class="fx-pill ${s.tipo === 'reserva' ? 'generada' : 'pendiente'}">${esc(TIPO_SOLICITUD[s.tipo] || s.tipo)}</span></div>
          <small class="fx-muted">${esc(cuando(s.creadoEn))}${s.estado ? ` · ${esc(s.estado)}` : ''}</small>
          <p style="margin:8px 0">${[s.telefono, s.email].filter(Boolean).map(esc).join(' · ')}</p>
          ${c ? `<p style="margin:0 0 8px"><b>${esc(String(c.cbm).replace('.', ','))} m³</b> · ${esc(c.modalidad === 'retiro' ? 'Retiro en Valencia' : `Puerta a puerta${c.estado ? ` a ${c.estado}` : ''}`)} · estimado <b>${usd(c.totalUsd)}</b></p>` : ''}
          ${s.mensaje ? `<p style="margin:0 0 8px">${esc(s.mensaje)}</p>` : ''}
          <div class="row">${link ? `<a class="btn btn-secondary btn-sm" href="${esc(link)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${s.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(s.email)}">Correo</a>` : ''}
            <button class="btn ${s.atendida ? 'btn-secondary' : 'btn-primary'} btn-sm" data-wt-sol="${esc(s.id)}" data-atendida="${s.atendida ? '0' : '1'}">${s.atendida ? 'Reabrir' : 'Marcar atendida'}</button></div>
        </article>`;
      }).join('') || `<div class="card section"><div class="empty">${verTodas ? 'Todavía no hay solicitudes de la web.' : 'No hay solicitudes pendientes.'}</div></div>`}</div>`;
    $('wtTodas').onchange = (e) => { verTodas = e.target.checked; mostrarSolicitudes(); };
    document.querySelectorAll('[data-wt-sol]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/web/solicitudes/${encodeURIComponent(b.dataset.wtSol)}`, { method: 'PUT', body: JSON.stringify({ atendida: b.dataset.atendida === '1' }) }); mostrarSolicitudes(); } catch (e) { toast(e.message); }
    }));
  }
})();
