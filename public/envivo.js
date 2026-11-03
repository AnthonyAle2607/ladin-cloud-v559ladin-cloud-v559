/**
 * Panel en vivo: cada pocos segundos vuelve a pedir los datos y, si cambiaron (otra persona del equipo editó algo),
 * repinta la vista actual. No interrumpe: espera si hay una ventana abierta, si se está escribiendo o si la pestaña
 * no está a la vista. La app móvil hace lo mismo con /api/app/version, así ambos muestran los mismos datos.
 */
(function () {
  'use strict';

  const CADA_MS = 20000;
  const VISTAS_CON_FORMULARIO = ['quote']; // el cotizador perdería lo escrito al repintar
  let ocupado = false;

  const huella = (d) => JSON.stringify(d);

  function sePuedeRepintar() {
    if (document.visibilityState !== 'visible') return false;
    if (document.getElementById('modal')?.classList.contains('show')) return false;
    if (VISTAS_CON_FORMULARIO.includes(currentView)) return false;
    const activo = document.activeElement;
    return !(activo && activo.closest?.('#page') && /^(INPUT|TEXTAREA|SELECT)$/.test(activo.tagName));
  }

  async function revisar() {
    if (ocupado || !session?.token || !document.getElementById('page') || !sePuedeRepintar()) return;
    ocupado = true;
    try {
      const nuevo = await api('/api/bootstrap');
      // Se compara con lo que hay en pantalla ahora (puede haber cambiado por una edición propia mientras tanto).
      if (huella(nuevo) !== huella(db) && sePuedeRepintar()) {
        db = nuevo;
        renderView();
      }
    } catch (_) {
      // sin red o sesión vencida: se reintenta en la siguiente vuelta (app.js maneja el cierre de sesión)
    } finally {
      ocupado = false;
    }
  }

  setInterval(revisar, CADA_MS);
  // Al volver a la pestaña se revisa de inmediato.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
})();
