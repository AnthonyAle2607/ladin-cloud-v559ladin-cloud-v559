# Criollo Cargo en Supabase

Esquema, seguridad y migración de datos para pasar la base de Criollo Cargo a Supabase (PostgreSQL).
El servidor Express **no cambia de forma de trabajar**: sigue con su login y sus JWT y entra a la base con una cadena de conexión.
No usa Supabase Auth ni la API REST, por eso todas las tablas quedan cerradas a la clave pública (RLS activado sin políticas).

## Qué hay

| Archivo | Para qué |
|---|---|
| `migrations/20261029000000_esquema_inicial.sql` | 14 tablas con llaves foráneas, índices, RLS y el bucket privado `etiquetas-fotos`. Se puede aplicar varias veces. |
| `../scripts/migrar-a-supabase.js` | Copia los datos de la base local (SQLite o Postgres) a Supabase conservando los `id`. |
| `../db.js` | Acepta `DATABASE_URL` + SSL y, con ella, **no cae a SQLite** si Supabase no responde. |

Llaves foráneas: borrar un cliente borra sus etiquetas (y de ahí lotes y fotos); borrar un contenedor deja las etiquetas sin contenedor; borrar un usuario deja vacíos sus campos en historial, clientes, recordatorios y quejas.

## Pasos

1. **Crear el proyecto** en supabase.com (región cercana a Venezuela, por ejemplo `us-east-1`) y guardar la contraseña de la base.
2. **Aplicar el esquema**, con una de dos vías:
   - Panel → *SQL Editor* → pegar el contenido de `migrations/20261029000000_esquema_inicial.sql` → *Run*.
   - Con la CLI: `supabase link --project-ref <ref>` y `supabase db push`.
3. **Cadena de conexión**: Panel → *Connect* → *Session pooler* (puerto 5432; sirve para un servidor que está siempre encendido). Es la `DATABASE_URL`.
   La conexión *Direct* es solo IPv6; el *Transaction pooler* (6543) también funciona con este servidor.
4. **Simulacro de migración** (no deja nada en Supabase):
   ```bash
   # con DATABASE_URL SIN definir; el origen es la base local de hoy
   set DATABASE_URL_DESTINO=postgresql://postgres.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:5432/postgres
   node scripts/migrar-a-supabase.js
   ```
   Muestra cuántas filas se copiarían por tabla y cuántas referencias huérfanas se corregirían. Si el origen es un volcado: `--json ladin_cloud_dump.json`.
5. **Migración real**: `node scripts/migrar-a-supabase.js --aplicar`. Va en una sola transacción y se niega a correr si el destino ya tiene datos.
6. **Apuntar el servidor**: en el entorno (Easypanel o `data.env`) definir `DATABASE_URL` con la misma cadena, `JWT_SECRET` y `ADMIN_PASSWORD`. Reiniciar.
   Para verificar el certificado de Supabase: descargar el certificado desde *Database → Settings → SSL* y definir `PGSSL_CA=<ruta>`; sin él la conexión va cifrada pero sin verificar al servidor.
7. **Comprobar**: entrar a la web, abrir un cliente y una etiqueta, y revisar en *Table Editor* que los datos estén.

## Cosas que conviene saber

- **Fotos**: las tablas guardan el nombre del archivo, pero el servidor todavía escribe las fotos en `uploads/etiquetas/` (disco del contenedor). En un contenedor sin disco persistente se pierden al redesplegar. El bucket privado `etiquetas-fotos` ya está creado para el siguiente paso: subir y servir las fotos desde Supabase Storage (cambio en `app-movil.js`).
- **Esquema al arrancar**: `ensureSchema()` del servidor sigue ejecutándose, pero con el esquema ya aplicado no cambia nada. Los cambios nuevos de esquema deben ir como archivos nuevos en `migrations/`.
- **Horas**: las columnas son `timestamp` sin zona, igual que hoy; Supabase corre en UTC. Las horas de recordatorios se guardan tal como llegan del navegador.
- **Copias de seguridad**: Supabase hace copias diarias en los planes de pago; en el plan gratuito no hay. La copia en CSV del sistema (*Copia de seguridad*) sigue funcionando.
- **Plan gratuito**: pausa el proyecto tras una semana sin uso. Para producción, usar un plan de pago.
