// Punto de entrada de Vercel: la app de Express completa como función sin servidor.
// vercel.json reenvía todas las rutas a esta función.
//
// Si falta configuración o el servidor no puede arrancar, se responde con un mensaje claro (y se deja el detalle en los registros)
// en vez de dejar que la función se caiga con FUNCTION_INVOCATION_FAILED, que no dice nada.
const REQUERIDAS = [
  ['JWT_SECRET', (v) => typeof v === 'string' && v.trim().length >= 32],
  ['DATABASE_URL', (v) => typeof v === 'string' && v.trim() !== ''],
];
// PERMITIR_SQLITE=1 solo lo usan las pruebas locales que simulan Vercel con una base SQLite; en Vercel real no se define.
const faltan = REQUERIDAS.filter(([nombre, valida]) => !(process.env.PERMITIR_SQLITE === '1' && nombre === 'DATABASE_URL') && !valida(process.env[nombre])).map(([nombre]) => nombre);

let servidor = null;
let falloAlCargar = null;
if (faltan.length === 0) {
  try {
    servidor = require('../server.js');
  } catch (e) {
    falloAlCargar = e;
    console.error('❌ No se pudo cargar el servidor:', e && e.stack ? e.stack : e);
  }
} else {
  console.error(`❌ Configuración incompleta: faltan o no son válidas las variables ${faltan.join(', ')} (entorno de Vercel: ${process.env.VERCEL_ENV || 'desconocido'}).`);
}

const responder = (res, estado, cuerpo) => {
  res.statusCode = estado;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(cuerpo));
};

module.exports = (req, res) => {
  if (faltan.length) {
    return responder(res, 503, { error: `Configuración incompleta del servidor: faltan o no son válidas ${faltan.join(' y ')}. Defínelas en Vercel (Settings → Environment Variables, para el entorno de este despliegue) y vuelve a desplegar.` });
  }
  if (falloAlCargar) {
    return responder(res, 500, { error: 'El servidor no pudo arrancar. Revisa los registros de la función en Vercel (Runtime Logs).' });
  }
  return servidor(req, res);
};
