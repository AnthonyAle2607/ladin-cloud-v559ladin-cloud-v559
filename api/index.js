// Punto de entrada de Vercel: la app de Express completa como función sin servidor.
// vercel.json reenvía /api/*, /f/* y /descargas/* a esta función; el resto (public/) lo sirve la CDN de Vercel.
module.exports = require('../server.js');