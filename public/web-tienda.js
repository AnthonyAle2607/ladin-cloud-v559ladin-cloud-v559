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
  const TIPO_SOLICITUD = { reserva: 'Reservar espacio', contacto: 'Contacto', aviso_producto: 'Avísame (tienda)', encargo: 'Pídelo de China' };

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
  let filtroEstado = '';
  /** Productos marcados para editar en lote (ids de la API). Sobrevive a recargar la lista. */
  const seleccion = new Set();
  let ultimoMarcado = null; // para marcar un rango con Mayús + clic

  const cupoDe = (p) => p.variantes.filter((v) => v.activa).reduce((s, v) => s + v.cupo, 0);
  const ESTADOS_LISTA = {
    borradores: ['Borradores (ocultos)', (p) => !p.activo],
    publicados: ['Publicados', (p) => p.activo],
    sinCupo: ['Sin cupo', (p) => cupoDe(p) === 0],
    sinContenedor: ['Sin contenedor', (p) => !p.contenedorId],
    sinFotos: ['Sin fotos', (p) => !p.imagenes.length],
  };
  const contenedoresAbiertos = () => db.containers.filter((c) => !['done', 'closed'].includes(c.status));

  async function mostrarProductos() {
    page().innerHTML = cargando('Productos de la tienda');
    try { [productos, categorias] = await Promise.all([api('/api/tienda/admin/productos'), api('/api/tienda/admin/categorias')]); }
    catch (e) { if (sigueEn('webProductos')) page().innerHTML = fallo('Productos de la tienda', e); return; }
    if (!sigueEn('webProductos')) return;
    const publicados = productos.filter((p) => p.activo);
    const sinCupo = publicados.filter((p) => !p.variantes.some((v) => v.activa && v.cupo > 0));
    page().innerHTML = `
      <div class="page-head"><div><h1>Productos de la tienda</h1><p>Preventa de la web: cada producto viaja en un contenedor y tiene un cupo por variante.</p></div>
        <div class="row"><button class="btn btn-secondary" id="wtCategorias">Categorías</button><button class="btn btn-secondary" id="wtDestinos">Destinos</button><button class="btn btn-secondary" id="wtLote">Carga masiva (Excel)</button><button class="btn btn-secondary" id="wtImportar">Importar desde 1688</button><button class="btn btn-primary" id="wtNuevo">Nuevo producto</button></div></div>
      <div class="fx-kpis">
        <div class="fx-kpi"><span>Publicados</span><b>${publicados.length}</b><small>de ${productos.length} producto(s)</small></div>
        <div class="fx-kpi"><span>Agotados</span><b>${sinCupo.length}</b><small>publicados sin cupo</small></div>
        <div class="fx-kpi"><span>Categorías</span><b>${categorias.filter((c) => c.activa).length}</b></div>
      </div>
      <div class="fx-toolbar">
        <input type="search" id="wtBuscar" placeholder="Buscar por nombre o contenedor" value="${esc(filtroProd)}" aria-label="Buscar productos">
        <select id="wtCat" aria-label="Categoría"><option value="">Todas las categorías</option>${categorias.map((c) => `<option value="${esc(c.id)}" ${filtroCat === c.id ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
        <select id="wtEstado" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(ESTADOS_LISTA).map(([k, [t, f]]) => `<option value="${k}" ${filtroEstado === k ? 'selected' : ''}>${esc(t)} (${productos.filter(f).length})</option>`).join('')}</select>
      </div>
      <div class="wt-lote-barra" id="wtLoteBarra" hidden>
        <b id="wtLoteCuenta"></b>
        <button class="btn btn-primary btn-sm" type="button" id="wtLoteEditar">Editar en lote</button>
        <button class="btn btn-secondary btn-sm" type="button" id="wtLotePublicar">Publicar</button>
        <button class="btn btn-secondary btn-sm" type="button" id="wtLoteOcultar">Ocultar</button>
        <button class="btn btn-secondary btn-sm" type="button" id="wtLoteLimpiar">Quitar selección</button>
      </div>
      <div class="card section"><div class="table-wrap fx-scroll"><table class="table"><thead><tr><th class="wt-sel"><input type="checkbox" id="wtSelTodos" aria-label="Seleccionar todos los de la lista"></th><th>Producto</th><th>Categoría</th><th>Contenedor</th><th class="fx-num">Precio</th><th class="fx-num">Cupo</th><th>Web</th><th></th></tr></thead><tbody id="wtFilas"></tbody></table></div></div>`;
    // Lo marcado que ya no existe (borrado o recargado) se quita de la selección.
    for (const id of [...seleccion]) if (!productos.some((p) => p.id === id)) seleccion.delete(id);
    pintarProductos();
    $('wtBuscar').oninput = (e) => { filtroProd = e.target.value; pintarProductos(); };
    $('wtCat').onchange = (e) => { filtroCat = e.target.value; pintarProductos(); };
    $('wtEstado').onchange = (e) => { filtroEstado = e.target.value; pintarProductos(); };
    $('wtSelTodos').onchange = (e) => { filtrados().forEach((p) => (e.target.checked ? seleccion.add(p.id) : seleccion.delete(p.id))); pintarProductos(); };
    $('wtLoteLimpiar').onclick = () => { seleccion.clear(); pintarProductos(); };
    $('wtLoteEditar').onclick = () => loteEdicionModal();
    $('wtLotePublicar').onclick = () => aplicarLote({ activo: true }, 'publicados');
    $('wtLoteOcultar').onclick = () => aplicarLote({ activo: false }, 'ocultos');
    $('wtNuevo').onclick = () => productoModal();
    $('wtImportar').onclick = importarModal;
    $('wtLote').onclick = loteModal;
    $('wtCategorias').onclick = categoriasModal;
    $('wtDestinos').onclick = destinosModal;
  }

  function filtrados() {
    const q = filtroProd.trim().toLowerCase();
    const est = ESTADOS_LISTA[filtroEstado]?.[1];
    return productos.filter((p) => (!filtroCat || p.categoriaId === filtroCat) && (!est || est(p)) && (!q || `${p.nombre} ${p.contenedor}`.toLowerCase().includes(q)));
  }

  function pintarProductos() {
    const cat = (id) => categorias.find((c) => c.id === id)?.nombre || '—';
    const filas = filtrados();
    const marcadosVisibles = filas.filter((p) => seleccion.has(p.id)).length;
    $('wtSelTodos').checked = filas.length > 0 && marcadosVisibles === filas.length;
    $('wtSelTodos').indeterminate = marcadosVisibles > 0 && marcadosVisibles < filas.length;
    $('wtLoteBarra').hidden = !seleccion.size;
    $('wtLoteCuenta').textContent = `${seleccion.size} seleccionado(s)${seleccion.size > marcadosVisibles ? ` · ${seleccion.size - marcadosVisibles} fuera del filtro` : ''}`;
    $('wtFilas').innerHTML = filas.length
      ? filas.map((p) => {
          const cupo = cupoDe(p);
          return `<tr class="${seleccion.has(p.id) ? 'wt-marcada' : ''}"><td class="wt-sel"><input type="checkbox" data-wt-sel="${esc(p.id)}" ${seleccion.has(p.id) ? 'checked' : ''} aria-label="Seleccionar ${esc(p.nombre)}"></td>
            <td><b>${esc(p.nombre)}</b><br><small class="fx-muted">/${esc(p.slug)} · ${p.variantes.filter((v) => v.activa).length} variante(s) · ${p.imagenes.length} foto(s)</small></td>
            <td>${esc(cat(p.categoriaId))}</td><td>${p.contenedor ? `<span class="code-pill">${esc(p.contenedor)}</span>` : '<span class="fx-warn">Sin contenedor</span>'}</td>
            <td class="fx-num">${usd(p.precioUsd)}${p.precioAntesUsd ? `<br><small class="fx-muted"><s>${usd(p.precioAntesUsd)}</s></small>` : ''}</td>
            <td class="fx-num">${cupo || '<span class="fx-bad">0</span>'}</td>
            <td>${p.activo ? '<span class="fx-pill pagada">Publicado</span>' : '<span class="fx-pill anulada">Oculto</span>'}</td>
            <td><div class="fx-table-actions"><button class="btn btn-secondary btn-sm" data-wt-editar="${esc(p.id)}">Editar</button></div></td></tr>`;
        }).join('')
      : `<tr><td colspan="8"><div class="empty compact">${productos.length ? 'Ningún producto coincide con el filtro.' : 'Todavía no hay productos. Crea el primero con «Nuevo producto».'}</div></td></tr>`;
    document.querySelectorAll('[data-wt-editar]').forEach((b) => (b.onclick = () => productoModal(productos.find((p) => p.id === b.dataset.wtEditar))));
    document.querySelectorAll('[data-wt-sel]').forEach((c) => (c.onclick = (e) => {
      const id = c.dataset.wtSel;
      const ids = filas.map((p) => p.id);
      // Mayús + clic marca (o desmarca) todo el rango desde el último marcado.
      const desde = e.shiftKey && ultimoMarcado ? ids.indexOf(ultimoMarcado) : -1;
      const tramo = desde >= 0 ? ids.slice(Math.min(desde, ids.indexOf(id)), Math.max(desde, ids.indexOf(id)) + 1) : [id];
      tramo.forEach((x) => (c.checked ? seleccion.add(x) : seleccion.delete(x)));
      ultimoMarcado = id;
      pintarProductos();
    }));
  }

  /** Aplica cambios a todos los seleccionados en una sola llamada (una transacción en el servidor). */
  async function aplicarLote(cambios, texto) {
    const ids = [...seleccion];
    if (!ids.length) return;
    if (cambios.activo === true) {
      // Se mira cómo quedará cada producto con los cambios de esta misma edición, no cómo está ahora.
      const contenedor = (p) => ('contenedorId' in cambios ? cambios.contenedorId : p.contenedorId);
      const cupo = (p) => ('cupo' in cambios ? cambios.cupo * p.variantes.filter((v) => v.activa).length : cupoDe(p));
      const sin = productos.filter((p) => seleccion.has(p.id) && (!contenedor(p) || cupo(p) === 0)).length;
      if (sin && !confirm(`${sin} de ${ids.length} no tienen contenedor o cupo: saldrán sin fecha de llegada o agotados. ¿Publicar igual?`)) return false;
    }
    try {
      const r = await api('/api/tienda/admin/productos/lote', { method: 'PUT', body: JSON.stringify({ ids, cambios }) });
      const avisos = [r.publicadosSinContenedor && `${r.publicadosSinContenedor} publicado(s) sin contenedor`, r.publicadosSinCupo && `${r.publicadosSinCupo} publicado(s) sin cupo`].filter(Boolean);
      toast(`${r.actualizados} producto(s) ${texto}.${avisos.length ? ` Ojo: ${avisos.join(' y ')}.` : ''}`);
      await mostrarProductos();
      return true;
    } catch (e) { toast(e.message); return false; }
  }

  function loteEdicionModal() {
    const n = seleccion.size;
    const opciones = (lista) => [['__', '— No cambiar —'], ...lista];
    openModal(`Editar ${n} producto(s) a la vez`, `
      <p class="fx-muted" style="margin:0 0 10px">Solo se cambia lo que elijas; lo que dejes en «No cambiar» queda como está en cada producto.</p>
      <div class="fx-grid">
        ${selectField('wtLContenedor', 'Viaja en el contenedor', opciones([['', 'Sin contenedor'], ...contenedoresAbiertos().map((c) => [c.id, `${c.number}${c.eta ? ` · llega ${c.eta}` : ''}`])]), '__')}
        ${selectField('wtLCategoria', 'Categoría', opciones([['', 'Sin categoría'], ...categorias.filter((c) => c.activa).map((c) => [c.id, c.nombre])]), '__')}
        ${field('wtLCupo', 'Cupo de cada variante', '', 'number', 'min="0" step="1" placeholder="No cambiar"')}
        ${field('wtLPrecio', 'Ajustar precio (%)', '', 'number', 'step="0.5" min="-89" max="500" placeholder="Ej.: 10 sube, −5 baja"')}
        ${selectField('wtLActivo', 'En la tienda', [['__', '— No cambiar —'], ['1', 'Publicar'], ['0', 'Ocultar']], '__')}
      </div>
      <p class="fx-muted" id="wtLResumen" style="margin:10px 0 0"></p>`,
      `<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="wtLAplicar">Aplicar a ${n}</button>`);
    $('modalCancel').onclick = closeModal;
    const leer = () => {
      const c = {};
      if ($('wtLContenedor').value !== '__') c.contenedorId = $('wtLContenedor').value;
      if ($('wtLCategoria').value !== '__') c.categoriaId = $('wtLCategoria').value;
      if ($('wtLCupo').value !== '') c.cupo = Number($('wtLCupo').value);
      if ($('wtLPrecio').value !== '' && Number($('wtLPrecio').value) !== 0) c.precioPct = Number($('wtLPrecio').value);
      if ($('wtLActivo').value !== '__') c.activo = $('wtLActivo').value === '1';
      return c;
    };
    const resumir = () => {
      const c = leer();
      const sel = productos.filter((p) => seleccion.has(p.id));
      const partes = [];
      if ('contenedorId' in c) partes.push(c.contenedorId ? `contenedor ${contenedoresAbiertos().find((k) => k.id === c.contenedorId)?.number}` : 'sin contenedor');
      if ('categoriaId' in c) partes.push(c.categoriaId ? `categoría ${categorias.find((k) => k.id === c.categoriaId)?.nombre}` : 'sin categoría');
      if ('cupo' in c) partes.push(`cupo ${c.cupo} en cada variante`);
      if ('precioPct' in c && sel.length) { const ej = sel[0]; partes.push(`precio ${c.precioPct > 0 ? '+' : ''}${c.precioPct} % (ej.: ${esc(ej.nombre)} ${usd(ej.precioUsd)} → ${usd(Math.round(ej.precioUsd * (1 + c.precioPct / 100) * 100) / 100)})`); }
      if ('activo' in c) partes.push(c.activo ? 'publicar' : 'ocultar');
      $('wtLResumen').innerHTML = partes.length ? `Se aplicará: ${partes.join(' · ')}.` : 'Elige al menos un cambio.';
    };
    ['wtLContenedor', 'wtLCategoria', 'wtLCupo', 'wtLPrecio', 'wtLActivo'].forEach((id) => { $(id).oninput = $(id).onchange = resumir; });
    resumir();
    $('wtLAplicar').onclick = async () => {
      const c = leer();
      if (!Object.keys(c).length) return toast('Elige al menos un cambio');
      if ('cupo' in c && !(Number.isInteger(c.cupo) && c.cupo >= 0)) return toast('El cupo debe ser un número entero, 0 o mayor');
      $('wtLAplicar').disabled = true;
      const ok = await aplicarLote(c, 'actualizados');
      if (ok) closeModal(); else if ($('wtLAplicar')) $('wtLAplicar').disabled = false;
    };
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

  /* ---------- Carga masiva desde Excel o CSV (tienda-lote.js) ---------- */

  function loteModal() {
    openModal('Carga masiva de productos', `
      <p class="fx-muted" style="margin:0 0 10px">Una fila por producto. Si el nombre ya existe, se <b>actualiza</b> (precio, cupo, textos, variantes); si no, se <b>crea</b>. Primero se revisa el archivo y nada se guarda hasta que confirmes.</p>
      <div class="row" style="margin-bottom:10px"><button class="btn btn-secondary btn-sm" id="wtLotePlantilla" type="button">Descargar plantilla Excel</button><span class="fx-muted">Trae las columnas, dos ejemplos y una hoja de instrucciones.</span></div>
      <div class="fx-grid"><div class="field"><label for="wtLoteArchivo">Archivo (.xlsx o .csv)</label><input type="file" id="wtLoteArchivo" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></div></div>
      <div id="wtLoteResultado"></div>`,
      '<button class="btn btn-secondary" id="modalCancel">Cerrar</button><button class="btn btn-primary" id="wtLoteRevisar">Revisar archivo</button>');
    $('modalCancel').onclick = () => { closeModal(); if (sigueEn('webProductos')) mostrarProductos(); };
    $('wtLotePlantilla').onclick = async () => {
      try {
        const r = await fetch('/api/tienda/admin/lote/plantilla', { headers: { Authorization: `Bearer ${session.token}` } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement('a');
        a.href = url; a.download = 'plantilla-tienda-criollo-cargo.xlsx'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (e) { toast(`No se pudo descargar la plantilla: ${e.message}`); }
    };
    $('wtLoteRevisar').onclick = async () => {
      const archivo = $('wtLoteArchivo').files?.[0];
      if (!archivo) return toast('Elige el archivo');
      const datos = new FormData();
      datos.append('archivo', archivo);
      const boton = $('wtLoteRevisar');
      boton.disabled = true; boton.textContent = 'Revisando…';
      try {
        const r = await fetch('/api/tienda/admin/lote/analizar', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: datos });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        mostrarLote(j);
      } catch (e) { $('wtLoteResultado').innerHTML = `<p class="fx-bad">${esc(e.message)}</p>`; }
      finally { boton.disabled = false; boton.textContent = 'Revisar de nuevo'; }
    };
  }

  function mostrarLote({ filas, resumen, columnas, porTanda }) {
    const validas = filas.filter((f) => !f.errores.length);
    const cupo = (f) => f.datos.variantes.reduce((s, v) => s + (Number(v.cupo) || 0), 0);
    $('wtLoteResultado').innerHTML = `<div class="fx-box" style="margin-top:12px">
      <h3>${resumen.total} fila(s): ${resumen.validas} lista(s) — ${resumen.crear} nueva(s) y ${resumen.actualizar} a actualizar${resumen.total - resumen.validas ? ` · <span class="fx-bad">${resumen.total - resumen.validas} con errores</span>` : ''}</h3>
      <p class="fx-muted" style="margin:0 0 8px">Columnas reconocidas: ${columnas.map(esc).join(', ')}.</p>
      <div class="fx-scroll" style="max-height:340px;overflow:auto"><table class="table"><thead><tr><th>Fila</th><th>Producto</th><th class="fx-num">Precio</th><th>Variantes</th><th class="fx-num">Cupo</th><th>Web</th><th>Resultado</th></tr></thead><tbody>
        ${filas.map((f) => `<tr id="wtLoteFila${f.fila}"><td>${f.fila}</td><td><b>${esc(f.datos.nombre || '—')}</b>${f.categoria ? `<br><small class="fx-muted">${esc(f.categoria)}</small>` : ''}</td>
          <td class="fx-num">${f.datos.precioUsd > 0 ? usd(f.datos.precioUsd) : '—'}</td><td>${esc(f.datos.variantes.map((v) => v.nombre).join(', '))}</td><td class="fx-num">${cupo(f)}</td>
          <td>${f.datos.activo ? 'Publicar' : 'Borrador'}</td>
          <td data-estado>${f.errores.length ? `<span class="fx-bad">${f.errores.map(esc).join('<br>')}</span>` : `${f.accion === 'crear' ? 'Se crea' : 'Se actualiza'}${f.avisos.length ? `<br><small class="fx-warn">${f.avisos.map(esc).join('<br>')}</small>` : ''}`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="wtLoteCargar" type="button" ${validas.length ? '' : 'disabled'}>Cargar ${validas.length} producto(s)</button><span class="fx-muted" id="wtLoteProgreso"></span></div></div>`;
    $('wtLoteCargar').onclick = async () => {
      const boton = $('wtLoteCargar');
      boton.disabled = true; $('wtLoteRevisar').disabled = true;
      const progreso = $('wtLoteProgreso');
      const marcar = (fila, html) => { const c = document.querySelector(`#wtLoteFila${fila} [data-estado]`); if (c) c.innerHTML = html; };
      let hechas = 0, fallas = 0;
      const conFotos = [];
      // Por tandas: cada llamada cabe en el límite de tiempo de Vercel.
      for (let i = 0; i < validas.length; i += porTanda) {
        const tanda = validas.slice(i, i + porTanda);
        progreso.textContent = `Guardando ${Math.min(i + tanda.length, validas.length)} de ${validas.length}…`;
        try {
          const r = await api('/api/tienda/admin/lote/aplicar', { method: 'POST', body: JSON.stringify({ filas: tanda.map((f) => ({ fila: f.fila, datos: f.datos, categoria: f.categoria, contenedor: f.contenedor, fotos: f.fotos })) }) });
          for (const x of r.resultados) {
            if (x.ok) { hechas++; marcar(x.fila, `<span class="fx-pill pagada">${x.accion === 'creado' ? 'Creado' : 'Actualizado'}</span>${x.aviso ? `<br><small class="fx-warn">${esc(x.aviso)}</small>` : ''}`); if (x.traerFotos) conFotos.push({ id: x.id, fila: x.fila, urls: tanda.find((f) => f.fila === x.fila)?.fotos || [] }); }
            else { fallas++; marcar(x.fila, `<span class="fx-bad">${esc(x.error)}</span>`); }
          }
        } catch (e) { fallas += tanda.length; tanda.forEach((f) => marcar(f.fila, `<span class="fx-bad">${esc(e.message)}</span>`)); }
      }
      for (const [n, p] of conFotos.entries()) {
        progreso.textContent = `Trayendo fotos ${n + 1} de ${conFotos.length}…`;
        try { const f = await api(`/api/tienda/admin/productos/${encodeURIComponent(p.id)}/imagenes-remotas`, { method: 'POST', body: JSON.stringify({ urls: p.urls }) }); const c = document.querySelector(`#wtLoteFila${p.fila} [data-estado]`); if (c) c.insertAdjacentHTML('beforeend', `<br><small class="fx-muted">${f.guardadas} de ${f.pedidas} foto(s)</small>`); } catch (_) { /* las fotos se pueden subir luego */ }
      }
      progreso.textContent = `Listo: ${hechas} producto(s) guardados${fallas ? `, ${fallas} con error` : ''}.`;
      toast(`Carga masiva: ${hechas} producto(s) guardados${fallas ? `, ${fallas} con error` : ''}`);
      $('wtLoteRevisar').disabled = false;
    };
  }

  /* ---------- Importar desde 1688 (importador-1688.js) ---------- */

  /** `previo.url`: enlace ya pegado (desde un encargo de «Pídelo de China»). Como manejador de clic recibe el evento. */
  async function importarModal(previo = {}) {
    let estado;
    try { estado = await api('/api/tienda/admin/importar/estado'); } catch (e) { return toast(e.message); }
    // Apify sirve para las dos cosas: buscar por palabra e importar por enlace.
    estado.busqueda = estado.busqueda || estado.apify;
    estado.api = estado.api || estado.apify;
    estadoImportador = estado;
    importados = [];
    openModal('Importar producto desde 1688', `
      <p class="fx-muted" style="margin:0 0 10px">Arma un <b>borrador sin publicar</b> con el nombre y la descripción traducidos y un precio sugerido. Tú lo revisas, pones el cupo y el contenedor, y lo publicas.</p>
      ${estado.ia ? '' : '<p class="fx-bad">La IA no está configurada en el servidor (IA_PROVEEDOR e IA_API_KEY): el importador no puede leer productos.</p>'}
      <div class="fx-box" style="margin:0 0 12px"><h3>Buscar en 1688</h3>
        ${estado.busqueda ? `<form id="wtBusForm" class="row" style="gap:8px;align-items:flex-end"><div class="field" style="flex:1;margin:0"><label for="wtBusQ">Qué buscas (español, inglés o chino)</label><input id="wtBusQ" maxlength="120" placeholder="freidora de aire · air fryer · 空气炸锅" autocomplete="off"></div><button class="btn btn-secondary" id="wtBusBoton" type="submit">Buscar</button></form>
          <div id="wtBusResultados"></div>`
        : '<p class="fx-muted" style="margin:0">La búsqueda se activa al configurar la API de un proveedor de datos (IMPORT_1688_BUSQUEDA_URL e IMPORT_1688_CLAVE en Vercel). Mientras tanto, importa por enlace con capturas o texto.</p>'}
      </div>
      <div class="fx-grid">${field('wtImpUrl', 'Enlace del producto (1688, Taobao, Yiwugo…)', '', 'url', 'placeholder="https://detail.1688.com/offer/…html"')}${field('wtImpCantidad', 'Cantidad que piensas comprar', '100', 'number', 'min="1" step="1" title="Elige el precio por cantidad que aplica"')}</div>
      <p class="fx-muted" style="margin:6px 0 10px">${estado.api ? 'Con el enlace basta: el servidor consulta la API del proveedor de datos. Para varios a la vez, pega abajo un enlace por línea.' : 'Aún no hay API de un proveedor de datos: el enlace se guarda como referencia. Sube <b>capturas</b> de la página (precio por cantidad, variantes y la tabla de la caja, 装箱) o <b>pega el texto</b> de la página. Con «Crear y seguir con otro» encadenas varios sin cerrar esta ventana.'}</p>
      ${estado.api ? `<div class="fx-grid"><div class="field"><label for="wtImpVarios">Varios enlaces (uno por línea)</label><textarea id="wtImpVarios" rows="3" maxlength="20000" placeholder="https://detail.1688.com/offer/…html"></textarea></div></div>` : ''}
      <div class="fx-grid">
        <div class="field"><label for="wtImpCapturas">Capturas de la página (hasta 4)</label><input type="file" id="wtImpCapturas" accept="image/jpeg,image/png,image/webp" multiple></div>
        <div class="field"><label for="wtImpTexto">Texto copiado de la página (opcional)</label><textarea id="wtImpTexto" rows="4" maxlength="40000" placeholder="Ctrl+A y Ctrl+C en la página del producto, y pega aquí"></textarea></div>
      </div>
      <div id="wtImpResultado"></div>`,
      `<button class="btn btn-secondary" id="modalCancel">Cancelar</button><button class="btn btn-primary" id="wtImpLeer" ${estado.ia ? '' : 'disabled'}>Leer producto</button>`);
    $('modalCancel').onclick = closeModal;
    if (estado.busqueda) $('wtBusForm').onsubmit = (e) => { e.preventDefault(); buscarEn1688(1, estado); };
    if (typeof previo?.url === 'string' && previo.url) $('wtImpUrl').value = previo.url;
    $('wtImpLeer').onclick = async () => {
      let varios = ($('wtImpVarios')?.value || '').split(/\s+/).filter((u) => /^https?:\/\//.test(u)).slice(0, 50);
      // Con Apify, un solo enlace (sin capturas ni texto) también se importa por la API.
      const soloEnlace = $('wtImpUrl').value.trim();
      if (!varios.length && estado.apify && soloEnlace && !$('wtImpTexto').value.trim() && !$('wtImpCapturas').files?.length) varios = [soloEnlace];
      if (varios.length) {
        const boton = $('wtImpLeer');
        boton.disabled = true;
        try { await importarVariosEnlaces(varios, Number($('wtImpCantidad').value) || 100); } finally { boton.disabled = false; boton.textContent = 'Leer producto'; }
        return;
      }
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
      <div class="row" style="margin-top:10px"><button class="btn btn-primary" id="wtImpCrear" type="button">Crear borrador y revisarlo</button><button class="btn btn-secondary" id="wtImpSeguir" type="button">Crear y seguir con otro</button></div></div>`;
    const crear = async (seguir) => {
      const nombre = $('wtImpNombre').value.trim();
      const precio = Number($('wtImpPrecio').value);
      if (!nombre) return toast('Escribe el nombre');
      if (!(precio > 0)) return toast('Indica el precio de venta');
      const botones = [$('wtImpCrear'), $('wtImpSeguir')];
      botones.forEach((b) => { b.disabled = true; });
      try {
        const r = await crearBorradorImportado(d, sugerido, urlPegada, { nombre, precioUsd: precio, categoriaId: $('wtImpCategoria').value, contenedorId: $('wtImpContenedor').value });
        toast(`Borrador «${nombre}» creado${r.fotosTexto}.${r.aviso ? ` ${r.aviso}` : ''}`);
        if (seguir) {
          // Listo para el siguiente producto, sin cerrar la ventana.
          ['wtImpUrl', 'wtImpTexto'].forEach((id) => { $(id).value = ''; });
          $('wtImpCapturas').value = '';
          $('wtImpResultado').innerHTML = `<p class="aviso-ok" style="color:var(--green)">✔ «${esc(nombre)}» quedó como borrador. Sube el siguiente.</p>`;
          if (importados.length > 1) ofrecerEdicionImportados($('wtImpResultado'));
          $('wtImpUrl').focus();
          return;
        }
        await mostrarProductos();
        const nuevo = productos.find((x) => x.id === r.id);
        if (nuevo) productoModal(nuevo); else closeModal();
      } catch (e) { toast(e.message); botones.forEach((b) => { if (b) b.disabled = false; }); }
    };
    $('wtImpCrear').onclick = () => crear(false);
    $('wtImpSeguir').onclick = () => crear(true);
  }

  /** Crea el borrador (sin publicar, cupo 0) de un producto leído por el importador y trae sus fotos. */
  async function crearBorradorImportado(d, sugerido, urlPegada, cambios = {}) {
    const r = await api('/api/tienda/admin/productos', { method: 'POST', body: JSON.stringify({
      nombre: d.nombre, categoriaId: '', contenedorId: '', origen: d.origen || '',
      precioUsd: sugerido?.precioUsd, nombreVariante: d.nombreVariante || 'Presentación', descripcion: d.descripcion, especificaciones: d.especificaciones, activo: false,
      // El cupo lo decide el equipo: el borrador nace en 0 y sin publicar.
      variantes: d.variantes.length ? d.variantes.map((v) => ({ nombre: v.nombre, cupo: 0, precioUsd: v.precioSugeridoUsd || null })) : [{ nombre: 'Única', cupo: 0 }],
      fuenteUrl: d.url || urlPegada || '',
      costoReferencia: { proveedor: d.proveedor, moneda: d.moneda, precios: d.precios, paquete: d.paquete, medidasUnidad: d.medidasUnidad, desglose: sugerido?.desglose || null, pedidoMinimo: d.pedidoMinimo, nombreOriginal: d.nombreOriginal },
      ...cambios,
    }) });
    let fotosTexto = '';
    if (d.imagenes.length) {
      try { const f = await api(`/api/tienda/admin/productos/${encodeURIComponent(r.id)}/imagenes-remotas`, { method: 'POST', body: JSON.stringify({ urls: d.imagenes }) }); fotosTexto = ` con ${f.guardadas} de ${f.pedidas} foto(s)`; } catch (_) { fotosTexto = ' (las fotos no se pudieron traer)'; }
    }
    importados.push(r.id);
    return { ...r, fotosTexto };
  }

  /** Borradores creados desde que se abrió el importador: al terminar se editan todos juntos. */
  let importados = [];

  /** Botón «Editar los N importados en lote»: cierra el importador, los deja marcados en la lista y abre la edición. */
  function ofrecerEdicionImportados(caja) {
    if (!importados.length || !caja) return;
    const ids = [...importados];
    const p = document.createElement('div');
    p.className = 'row';
    p.style.marginTop = '10px';
    p.innerHTML = `<button class="btn btn-primary btn-sm" type="button">Asignar contenedor, cupo y publicar los ${ids.length} importado(s)</button>`;
    caja.appendChild(p);
    p.querySelector('button').onclick = async () => {
      closeModal();
      seleccion.clear();
      ids.forEach((id) => seleccion.add(id));
      filtroProd = ''; filtroCat = ''; filtroEstado = '';
      await mostrarProductos();
      if (seleccion.size) loteEdicionModal();
    };
  }

  let estadoImportador = {};

  /**
   * Apify: lanza el trabajo y consulta cada 4 s hasta que termine (cada consulta es corta: cabe en Vercel).
   * `aviso` recibe el texto de progreso. Devuelve { resultados, fichas }.
   */
  async function trabajoApify(cuerpo, aviso) {
    const { run } = await api('/api/tienda/admin/importar/apify', { method: 'POST', body: JSON.stringify(cuerpo) });
    const inicio = Date.now();
    while (Date.now() - inicio < 6 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 4000));
      aviso(`Trabajando en Apify… ${Math.round((Date.now() - inicio) / 1000)} s`);
      const r = await api(`/api/tienda/admin/importar/apify/${encodeURIComponent(run)}`);
      if (r.estado === 'listo') return r;
      if (r.estado === 'fallo') throw new Error(r.error);
    }
    throw new Error('Apify tardó más de 6 minutos. Revisa el trabajo en apify.com.');
  }

  /** Búsqueda por palabra en 1688 (API del proveedor de datos): tarjetas para marcar e importar como borradores. */
  async function buscarEn1688(pagina, estado) {
    const q = $('wtBusQ').value.trim();
    if (q.length < 2) return toast('Escribe qué buscar');
    const caja = $('wtBusResultados');
    const boton = $('wtBusBoton');
    boton.disabled = true; boton.textContent = 'Buscando…';
    caja.innerHTML = '<p class="fx-muted" id="wtBusAviso">Buscando en 1688 y traduciendo los títulos…</p>';
    try {
      const r = estado.apify
        ? await trabajoApify({ q, max: 20 * pagina }, (t) => { if ($('wtBusAviso')) $('wtBusAviso').textContent = `${t} (una búsqueda suele tardar menos de un minuto)`; })
        : await api('/api/tienda/admin/importar/buscar', { method: 'POST', body: JSON.stringify({ q, pagina }) });
      // En Apify, «más resultados» repite la búsqueda pidiendo más: se muestran solo los nuevos.
      if (estado.apify && pagina > 1) r.resultados = r.resultados.slice(20 * (pagina - 1));
      const precio = (x) => (x.precio ? `${x.moneda === 'USD' ? 'US$' : '¥'}${Number(x.precio).toLocaleString('es-VE', { maximumFractionDigits: 2 })}` : '');
      caja.innerHTML = r.resultados.length ? `
        <div class="wt-busqueda">${r.resultados.map((x, i) => `<label class="wt-resultado">
          <input type="checkbox" data-bus="${i}" aria-label="Elegir ${esc(x.titulo)}">
          ${x.imagen ? `<img src="${esc(x.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="wt-sinfoto">Sin foto</span>'}
          <b>${esc(x.titulo)}</b>
          <small class="fx-muted">${[precio(x), x.pedidoMinimo ? `mín. ${x.pedidoMinimo}` : '', x.ubicacion].filter(Boolean).map(esc).join(' · ')}</small>
          ${x.proveedor ? `<small class="fx-muted">${esc(x.proveedor)}</small>` : ''}
          <a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">Ver en 1688</a></label>`).join('')}</div>
        <div class="row" style="margin-top:10px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="wtBusTodos" type="button">Seleccionar todos</button>
          ${pagina > 1 ? '<button class="btn btn-secondary btn-sm" id="wtBusAnterior" type="button">‹ Anterior</button>' : ''}
          <button class="btn btn-secondary btn-sm" id="wtBusSiguiente" type="button">Más resultados ›</button>
          <button class="btn btn-primary btn-sm" id="wtBusImportar" type="button" disabled>Importar seleccionados</button>
          <span class="fx-muted">Página ${pagina}</span></div>`
        : '<p class="fx-muted">Sin resultados. Prueba con otra palabra (en chino suele encontrar más).</p>';
      if (!r.resultados.length) return;
      const marcados = () => [...caja.querySelectorAll('[data-bus]:checked')].map((c) => r.resultados[+c.dataset.bus]);
      const casillas = [...caja.querySelectorAll('[data-bus]')];
      const contar = () => {
        const n = marcados().length;
        $('wtBusImportar').disabled = !n;
        $('wtBusImportar').textContent = n ? `Importar ${n} seleccionado(s)` : 'Importar seleccionados';
        $('wtBusTodos').textContent = n === casillas.length ? 'Quitar todos' : 'Seleccionar todos';
      };
      let ultimo = null;
      casillas.forEach((c, i) => {
        // Mayús + clic marca todo el tramo desde la última casilla tocada.
        c.onclick = (e) => {
          if (e.shiftKey && ultimo != null) casillas.slice(Math.min(ultimo, i), Math.max(ultimo, i) + 1).forEach((x) => { x.checked = c.checked; });
          ultimo = i;
          contar();
        };
      });
      $('wtBusTodos').onclick = () => { const todos = marcados().length !== casillas.length; casillas.forEach((x) => { x.checked = todos; }); contar(); };
      $('wtBusSiguiente').onclick = () => buscarEn1688(pagina + 1, estado);
      if ($('wtBusAnterior')) $('wtBusAnterior').onclick = () => buscarEn1688(pagina - 1, estado);
      $('wtBusImportar').onclick = async () => {
        const elegidos = marcados();
        if (!estado.api) return toast('Para importar falta IMPORT_1688_URL (la consulta de cada producto) en el servidor');
        $('wtBusImportar').disabled = true;
        await importarVariosEnlaces(elegidos.map((x) => x.url), Number($('wtImpCantidad').value) || 100);
        $('wtBusImportar').disabled = false;
        $('wtImpResultado').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
    } catch (e) { caja.innerHTML = `<p class="fx-bad">${esc(e.message)}</p>`; }
    finally { boton.disabled = false; boton.textContent = 'Buscar'; }
  }

  /** Con API del proveedor de datos: una lista de enlaces se convierte en borradores, uno tras otro. */
  async function importarVariosEnlaces(urls, cantidad) {
    const caja = $('wtImpResultado');
    caja.innerHTML = `<div class="fx-box" style="margin-top:12px"><h3>Importando ${urls.length} enlace(s)</h3><ol id="wtImpLista" style="margin:0;padding-left:20px"></ol><p class="fx-muted" id="wtImpProgreso"></p></div>`;
    let ok = 0;
    if (estadoImportador.apify) {
      // Apify descarga todas las fichas en un solo trabajo; luego la IA traduce cada una y se crea su borrador.
      let fichas;
      try { fichas = (await trabajoApify({ enlaces: urls }, (t) => { $('wtImpProgreso').textContent = `${t}: descargando ${urls.length} ficha(s) de 1688…`; })).fichas; }
      catch (e) { $('wtImpProgreso').innerHTML = `<span class="fx-bad">${esc(e.message)}</span>`; return; }
      for (const [i, f] of fichas.entries()) {
        $('wtImpProgreso').textContent = `Traduciendo y creando ${i + 1} de ${fichas.length}…`;
        const li = document.createElement('li');
        li.textContent = f.url;
        $('wtImpLista').appendChild(li);
        try {
          const datos = new FormData();
          datos.append('crudo', f.crudo);
          if (f.url) datos.append('url', f.url);
          datos.append('cantidad', String(cantidad));
          const r = await fetch('/api/tienda/admin/importar', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: datos });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          if (!j.sugerido) throw new Error('sin precio: revísalo con capturas');
          const b = await crearBorradorImportado(j.datos, j.sugerido, f.url);
          ok++;
          li.innerHTML = `<b>${esc(j.datos.nombre)}</b> · $${j.sugerido.precioUsd}${esc(b.fotosTexto)} <span class="fx-pill pagada">Borrador</span>`;
        } catch (e) { li.innerHTML = `${esc(f.url)} <span class="fx-bad">${esc(e.message)}</span>`; }
      }
      $('wtImpProgreso').textContent = `Listo: ${ok} de ${urls.length} borrador(es). ${fichas.length < urls.length ? `Apify no devolvió ${urls.length - fichas.length} enlace(s). ` : ''}${ok ? 'Asígnales contenedor y cupo y publícalos de una vez:' : ''}`;
      ofrecerEdicionImportados($('wtImpProgreso').parentElement);
      return;
    }
    for (const [i, url] of urls.entries()) {
      $('wtImpProgreso').textContent = `Leyendo ${i + 1} de ${urls.length}…`;
      const li = document.createElement('li');
      li.textContent = url;
      $('wtImpLista').appendChild(li);
      try {
        const datos = new FormData();
        datos.append('url', url);
        datos.append('cantidad', String(cantidad));
        const r = await fetch('/api/tienda/admin/importar', { method: 'POST', headers: { Authorization: `Bearer ${session.token}` }, body: datos });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (!j.sugerido) throw new Error('sin precio: impórtalo con capturas');
        const b = await crearBorradorImportado(j.datos, j.sugerido, url);
        ok++;
        li.innerHTML = `<b>${esc(j.datos.nombre)}</b> · $${j.sugerido.precioUsd}${esc(b.fotosTexto)} <span class="fx-pill pagada">Borrador</span>`;
      } catch (e) { li.innerHTML = `${esc(url)} <span class="fx-bad">${esc(e.message)}</span>`; }
    }
    $('wtImpProgreso').textContent = `Listo: ${ok} de ${urls.length} borrador(es).${ok ? ' Asígnales contenedor y cupo y publícalos de una vez:' : ''}`;
    ofrecerEdicionImportados($('wtImpProgreso').parentElement);
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
      <div class="page-head"><div><h1>Solicitudes de la web</h1><p>Encargos de «Pídelo de China», «Reservar espacio» del cotizador, mensajes de contacto y avisos de la tienda. Escríbele al cliente y márcala como atendida.</p></div>
        <div class="row"><label class="wt-check" style="margin:0"><input type="checkbox" id="wtTodas" ${verTodas ? 'checked' : ''}> Ver también las atendidas</label></div></div>
      <div class="wt-solicitudes">${lista.map((s) => {
        const c = s.cotizacion;
        const en = s.encargo;
        const link = wa(s.telefono, en ? `Hola ${s.nombre}, te escribimos de Criollo Cargo por tu encargo «Pídelo de China».` : `Hola ${s.nombre}, te escribimos de Criollo Cargo por tu solicitud en la web.`);
        return `<article class="fx-box wt-sol ${s.atendida ? 'is-done' : ''}">
          <div class="row" style="justify-content:space-between;align-items:baseline"><b>${esc(s.nombre)}</b><span class="fx-pill ${s.tipo === 'reserva' || en ? 'generada' : 'pendiente'}">${esc(TIPO_SOLICITUD[s.tipo] || s.tipo)}</span></div>
          <small class="fx-muted">${esc(cuando(s.creadoEn))}${s.estado ? ` · ${esc(s.estado)}` : ''}</small>
          <p style="margin:8px 0">${[s.telefono, s.email].filter(Boolean).map(esc).join(' · ')}</p>
          ${c ? `<p style="margin:0 0 8px"><b>${esc(String(c.cbm).replace('.', ','))} m³</b> · ${esc(c.modalidad === 'retiro' ? 'Retiro en Valencia' : `Puerta a puerta${c.estado ? ` a ${c.estado}` : ''}`)} · estimado <b>${usd(c.totalUsd)}</b></p>` : ''}
          ${s.mensaje ? `<p style="margin:0 0 8px;white-space:pre-line">${esc(s.mensaje)}</p>` : ''}
          ${en?.cantidad ? `<p style="margin:0 0 8px"><b>Cantidad:</b> ${esc(en.cantidad)}</p>` : ''}
          ${en?.enlaces?.length ? `<p style="margin:0 0 8px;overflow-wrap:anywhere">${en.enlaces.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join('<br>')}</p>` : ''}
          ${en?.fotos?.length ? `<div class="wt-fotos" style="margin:0 0 8px">${en.fotos.map((f) => `<figure class="wt-foto wt-foto-sol" data-foto-sol="${esc(f.url)}"><span class="fx-muted">…</span></figure>`).join('')}</div>` : ''}
          <div class="row wt-sol-acciones">${en ? `<button class="btn btn-primary btn-sm" type="button" data-wt-importar="${esc(en.enlaces?.[0] || '')}">Abrir en el importador</button>` : ''}${link ? `<a class="btn btn-secondary btn-sm" href="${esc(link)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${s.email ? `<a class="btn btn-secondary btn-sm" href="mailto:${esc(s.email)}">Correo</a>` : ''}
            <button class="btn ${s.atendida ? 'btn-secondary' : 'btn-primary'} btn-sm" data-wt-sol="${esc(s.id)}" data-atendida="${s.atendida ? '0' : '1'}">${s.atendida ? 'Reabrir' : 'Marcar atendida'}</button></div>
        </article>`;
      }).join('') || `<div class="card section"><div class="empty">${verTodas ? 'Todavía no hay solicitudes de la web.' : 'No hay solicitudes pendientes.'}</div></div>`}</div>`;
    $('wtTodas').onchange = (e) => { verTodas = e.target.checked; mostrarSolicitudes(); };
    // Fotos de los encargos (privadas: se piden con la sesión).
    document.querySelectorAll('[data-foto-sol]').forEach((fig) => {
      urlBlob(fig.dataset.fotoSol).then((u) => { fig.innerHTML = `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Foto del encargo"></a>`; }).catch(() => { fig.innerHTML = '<span class="fx-muted">Sin foto</span>'; });
    });
    // El encargo se cotiza con el importador: abre la ventana con el primer enlace ya pegado.
    document.querySelectorAll('[data-wt-importar]').forEach((b) => (b.onclick = () => importarModal({ url: b.dataset.wtImportar })));
    document.querySelectorAll('[data-wt-sol]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/web/solicitudes/${encodeURIComponent(b.dataset.wtSol)}`, { method: 'PUT', body: JSON.stringify({ atendida: b.dataset.atendida === '1' }) }); mostrarSolicitudes(); } catch (e) { toast(e.message); }
    }));
  }
})();
