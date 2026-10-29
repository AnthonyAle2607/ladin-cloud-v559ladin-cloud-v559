/**
 * Rutas que la web ya llamaba pero el servidor no tenía:
 *   POST /api/usuarios, PUT /api/usuarios/:id   crear y editar asesoras / administradores (pantalla «Usuarios»)
 *   GET  /api/portfolio?advisorId=              cartera de una asesora (pantalla «Cartera y mercancía»)
 */
const bcrypt = require('bcrypt');

const MIN_CLAVE = 8;

function registrar(app, { db, auth, intId, logAction, userOut, getBootstrap }) {
  const soloAdmin = (req, res, next) => (req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede gestionar usuarios' }));

  /** Valida el cuerpo; devuelve { datos } o { error }. `existente` = fila actual al editar. */
  async function validar(b, existente) {
    const nombre = String(b.name ?? existente?.nombre ?? '').trim();
    const email = String(b.email ?? existente?.email ?? '').trim().toLowerCase();
    const rol = b.role ?? existente?.rol ?? 'asesora';
    const activo = b.active === undefined ? (existente ? !!existente.activo : true) : b.active === true || b.active === 'true';
    if (!nombre || nombre.length > 150) return { error: 'El nombre es obligatorio (máximo 150 caracteres)' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 150) return { error: 'El correo no es válido' };
    if (!['asesora', 'admin'].includes(rol)) return { error: 'Rol no válido' };
    const clave = String(b.password ?? '');
    if (!existente && clave.length < MIN_CLAVE) return { error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres` };
    if (existente && clave && clave.length < MIN_CLAVE) return { error: `La contraseña debe tener al menos ${MIN_CLAVE} caracteres` };
    const dup = (await db.query('SELECT id FROM usuarios WHERE LOWER(email)=$1', [email])).rows[0];
    if (dup && (!existente || dup.id !== existente.id)) return { error: 'Ya existe un usuario con ese correo' };
    let codigo = rol === 'asesora' ? String(b.advisorCode ?? existente?.codigo_asesora ?? '').trim().slice(0, 30) : '';
    if (codigo) {
      const dupCod = (await db.query('SELECT id FROM usuarios WHERE LOWER(codigo_asesora)=LOWER($1)', [codigo])).rows[0];
      if (dupCod && (!existente || dupCod.id !== existente.id)) return { error: `El código ${codigo} ya lo usa otra asesora` };
    }
    return { datos: { nombre, email, rol, activo, codigo, clave } };
  }

  app.post('/api/usuarios', auth, soloAdmin, async (req, res) => {
    try {
      const { datos: d, error } = await validar(req.body || {}, null);
      if (error) return res.status(400).json({ error });
      const hash = await bcrypt.hash(d.clave, 12);
      const r = await db.query('INSERT INTO usuarios(nombre,email,password_hash,rol,activo,codigo_asesora) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [d.nombre, d.email, hash, d.rol, d.activo, d.codigo || null]);
      let u = r.rows[0];
      if (d.rol === 'asesora' && !d.codigo) { // código automático, como hace el arranque del servidor
        const auto = `ASE-${String(u.id).padStart(3, '0')}`;
        await db.query('UPDATE usuarios SET codigo_asesora=$1 WHERE id=$2', [auto, u.id]);
        u = { ...u, codigo_asesora: auto };
      }
      await logAction(req.user.id, `Usuario ${d.nombre} creado`, 'usuarios', u.id, `Rol ${d.rol}.`);
      res.status(201).json(userOut(u));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo crear el usuario' }); }
  });

  app.put('/api/usuarios/:id', auth, soloAdmin, async (req, res) => {
    try {
      const id = intId(req.params.id);
      const actual = (await db.query('SELECT * FROM usuarios WHERE id=$1', [id])).rows[0];
      if (!actual) return res.status(404).json({ error: 'Usuario no encontrado' });
      const { datos: d, error } = await validar(req.body || {}, actual);
      if (error) return res.status(400).json({ error });
      // Nunca dejar el sistema sin un administrador activo.
      if (actual.rol === 'admin' && (d.rol !== 'admin' || !d.activo)) {
        const otros = (await db.query("SELECT COUNT(*) AS n FROM usuarios WHERE rol='admin' AND activo=TRUE AND id<>$1", [id])).rows[0];
        if (Number(otros.n) === 0) return res.status(409).json({ error: 'Debe quedar al menos un administrador activo' });
      }
      if (d.clave) await db.query('UPDATE usuarios SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(d.clave, 12), id]);
      await db.query('UPDATE usuarios SET nombre=$1,email=$2,rol=$3,activo=$4,codigo_asesora=$5 WHERE id=$6', [d.nombre, d.email, d.rol, d.activo, d.codigo || null, id]);
      await logAction(req.user.id, `Usuario ${d.nombre} actualizado`, 'usuarios', id, d.clave ? 'Se cambió la contraseña.' : '');
      const u = (await db.query('SELECT * FROM usuarios WHERE id=$1', [id])).rows[0];
      res.json(userOut(u));
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo actualizar el usuario' }); }
  });

  app.get('/api/portfolio', auth, async (req, res) => {
    try {
      // La asesora solo ve su propia cartera, pida lo que pida.
      const asesoraId = req.user.rol === 'admin' ? intId(req.query.advisorId) : req.user.id;
      if (!asesoraId) return res.json({ clients: [], labels: [], containers: [] });
      const b = await getBootstrap({ id: asesoraId, rol: 'asesora' });
      res.json({ clients: b.clients, labels: b.labels, containers: b.containers });
    } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo cargar la cartera' }); }
  });
}

module.exports = { registrar };
