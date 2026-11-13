/**
 * Código de cliente en el formulario: [SEDE][ORIGEN]-[TIPO]-[CORRELATIVO] (CCMI-G-0015).
 *  - Al crear: se eligen sede, origen y tipo; el correlativo lo pone el servidor al guardar. Si se escribe un código a
 *    mano, se respeta.
 *  - Al editar: cambiar sede, origen o tipo rearma el código con el MISMO correlativo.
 *  - El administrador puede cambiar el catálogo (agregar sedes como MG Margarita o PO Puerto Ordaz).
 * Envía al guardar `codeParts` (app.js lo pide con CodigoCliente.partes()).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PATRON = /^([A-Z]{2})([A-Z]{2})-([A-Z])-(\d{4,9})$/;
  let catalogo = null;

  const partesDe = (codigo) => { const m = String(codigo || '').trim().toUpperCase().match(PATRON); return m ? { sede: m[1], origen: m[2], tipo: m[3], numero: Number(m[4]) } : null; };
  const armar = (p, numero) => `${p.sede}${p.origen}-${p.tipo}-${String(numero).padStart(4, '0')}`;
  const elegidas = () => ($('ccSede') ? { sede: $('ccSede').value, origen: $('ccOrigen').value, tipo: $('ccTipo').value } : null);

  async function leerCatalogo(forzar = false) {
    if (!catalogo || forzar) catalogo = await api('/api/ajustes/codigo-cliente');
    return catalogo;
  }

  const opciones = (lista, actual) => lista.map((x) => `<option value="${esc(x.codigo)}" ${x.codigo === actual ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nombre)}</option>`).join('');

  async function ponerSelectores(existente) {
    const codigo = $('mCode');
    if (!codigo) return;
    let cat;
    try { cat = await leerCatalogo(); } catch { return; }
    if ($('mCode') !== codigo || $('ccSede')) return; // el formulario ya se cerró o ya tiene los selectores
    const actuales = partesDe(existente?.code) || cat.defecto;
    const html = `<div class="fx-box" id="ccCaja" style="margin:8px 0 12px;grid-column:1/-1"><div class="fx-grid">
        <div class="field"><label for="ccSede">Sede (dónde se registró)</label><select id="ccSede">${opciones(cat.sedes, actuales.sede)}</select></div>
        <div class="field"><label for="ccOrigen">Origen de la carga</label><select id="ccOrigen">${opciones(cat.origenes, actuales.origen)}</select></div>
        <div class="field"><label for="ccTipo">Tipo de mercancía</label><select id="ccTipo">${opciones(cat.tipos, actuales.tipo)}</select></div>
      </div><small class="fx-muted" id="ccVista"></small>
      ${me()?.role === 'admin' ? ' <button type="button" class="btn btn-secondary btn-sm" id="ccCatalogo" style="margin-top:6px">Editar sedes, orígenes y tipos…</button>' : ''}</div>`;
    (codigo.closest('.field') || codigo).insertAdjacentHTML('afterend', html);

    const numeroActual = partesDe(existente?.code)?.numero;
    const vista = () => {
      const p = elegidas();
      if (existente && numeroActual) {
        // Editar: mismo correlativo, nuevas letras.
        codigo.value = armar(p, numeroActual);
        $('ccVista').textContent = 'Cambiar sede, origen o tipo actualiza el código; el correlativo se mantiene.';
      } else if (!existente) {
        $('ccVista').innerHTML = codigo.value.trim()
          ? 'Se usará el código escrito a mano.'
          : `Quedará como <b>${esc(`${p.sede}${p.origen}-${p.tipo}-`)}</b> + el siguiente correlativo (se asigna al guardar).`;
      } else {
        $('ccVista').textContent = 'Este cliente tiene un código con otro formato: escribe el nuevo o vacía el campo para que se arme solo.';
      }
    };
    ['ccSede', 'ccOrigen', 'ccTipo'].forEach((id) => ($(id).onchange = vista));
    codigo.addEventListener('input', () => { if (!existente) vista(); });
    vista();
    $('ccCatalogo')?.addEventListener('click', () => editarCatalogo(existente));
  }

  /** Administrador: catálogo de sedes, orígenes y tipos (una por línea: «CC = Caracas»). */
  function editarCatalogo(existente) {
    const c = catalogo;
    const txt = (lista) => lista.map((x) => `${x.codigo} = ${x.nombre}`).join('\n');
    openModal('Catálogo del código de cliente', `
      <p class="fx-muted" style="margin-top:0">Una opción por línea: <b>código = nombre</b>. Sedes y orígenes llevan 2 letras; el tipo, 1 letra. Ej.: <code>MG = Margarita</code>.</p>
      <div class="fx-grid">
        <div class="field"><label for="ccatSedes">Sedes</label><textarea id="ccatSedes" rows="7">${esc(txt(c.sedes))}</textarea></div>
        <div class="field"><label for="ccatOrigenes">Orígenes</label><textarea id="ccatOrigenes" rows="7">${esc(txt(c.origenes))}</textarea></div>
        <div class="field"><label for="ccatTipos">Tipos</label><textarea id="ccatTipos" rows="7">${esc(txt(c.tipos))}</textarea></div>
      </div>
      <div class="fx-grid">
        <div class="field"><label for="ccatDefSede">Sede por defecto</label><input id="ccatDefSede" maxlength="2" value="${esc(c.defecto.sede)}"></div>
        <div class="field"><label for="ccatDefOrigen">Origen por defecto</label><input id="ccatDefOrigen" maxlength="2" value="${esc(c.defecto.origen)}"></div>
        <div class="field"><label for="ccatDefTipo">Tipo por defecto</label><input id="ccatDefTipo" maxlength="1" value="${esc(c.defecto.tipo)}"></div>
      </div>
      <small class="fx-muted">Los valores por defecto se usan en los clientes que se crean sin elegir (importación y «Contactos por asignar»).</small>`,
      '<button class="btn btn-secondary" id="modalCancel">Volver</button><button class="btn btn-primary" id="ccatGuardar">Guardar</button>');
    const volver = () => { closeModal(); clientModal(existente); };
    $('modalCancel').onclick = volver;
    const leer = (id) => $(id).value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [cod, ...resto] = l.split('='); return { codigo: cod.trim().toUpperCase(), nombre: resto.join('=').trim() }; });
    $('ccatGuardar').onclick = async () => {
      try {
        catalogo = await api('/api/ajustes/codigo-cliente', { method: 'PUT', body: JSON.stringify({
          sedes: leer('ccatSedes'), origenes: leer('ccatOrigenes'), tipos: leer('ccatTipos'),
          defecto: { sede: $('ccatDefSede').value.trim().toUpperCase(), origen: $('ccatDefOrigen').value.trim().toUpperCase(), tipo: $('ccatDefTipo').value.trim().toUpperCase() },
        }) });
        toast('Catálogo guardado');
        volver();
      } catch (e) { toast(e.message); }
    };
  }

  const modalOriginal = window.clientModal;
  window.clientModal = function (existing = null) {
    const r = modalOriginal.apply(this, arguments);
    ponerSelectores(existing);
    return r;
  };

  window.CodigoCliente = { partes: elegidas, partesDe };
})();
