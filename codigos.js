/**
 * Código de cliente correlativo: CC-001, CC-002… (como el número de las etiquetas). Con más de 999 sigue CC-1000.
 * Si al crear el cliente se escribe un código a mano, se respeta; si se deja vacío, lo pone el sistema.
 */
const PATRON = /^CC-(\d{1,9})$/i;
const formato = (n) => `CC-${String(n).padStart(3, '0')}`;

/** Siguiente código libre. `q` es la base o la transacción en curso; `minimo` sirve para saltar uno que ya se tomó. */
async function siguienteCodigoCliente(q, minimo = 1) {
  const r = await q.query("SELECT codigo_cliente FROM clientes WHERE codigo_cliente LIKE 'CC-%' OR codigo_cliente LIKE 'cc-%'");
  let mayor = 0;
  for (const x of r.rows) { const m = String(x.codigo_cliente || '').trim().match(PATRON); if (m) mayor = Math.max(mayor, Number(m[1])); }
  return formato(Math.max(mayor + 1, minimo));
}

/**
 * Pone el código correlativo a un cliente recién creado. Si otro se lo ganó al mismo tiempo (índice único), toma el
 * siguiente. Dentro de una transacción el choque la aborta, así que ahí se usa un SAVEPOINT.
 */
async function asignarCodigoCliente(q, id, { enTransaccion = false } = {}) {
  let codigo = await siguienteCodigoCliente(q);
  for (let intento = 0; ; intento++) {
    try {
      if (enTransaccion) await q.query('SAVEPOINT codigo_cliente');
      await q.query('UPDATE clientes SET codigo_cliente=$1 WHERE id=$2', [codigo, id]);
      if (enTransaccion) await q.query('RELEASE SAVEPOINT codigo_cliente');
      return codigo;
    } catch (e) {
      if (enTransaccion) await q.query('ROLLBACK TO SAVEPOINT codigo_cliente');
      if (e.code !== '23505' || intento >= 5) throw e;
      codigo = await siguienteCodigoCliente(q, Number(codigo.slice(3)) + 1);
    }
  }
}

module.exports = { siguienteCodigoCliente, asignarCodigoCliente, formatoCodigoCliente: formato };
