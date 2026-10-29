-- Criollo Cargo: esquema inicial para Supabase (PostgreSQL).
-- Es el esquema que el servidor crea hoy con ensureSchema() + las tablas de la app móvil (app-movil.js), ahora con
-- llaves foráneas, índices y seguridad a nivel de fila. Es idempotente: se puede correr varias veces.
--
-- Acceso: el servidor Express entra con la cadena de conexión de Postgres (rol postgres) y sigue usando su propio
-- login con JWT; no usa Supabase Auth ni la API REST. Por eso TODAS las tablas llevan RLS activado SIN políticas y se
-- revoca todo a anon/authenticated: la clave pública de Supabase no puede leer ni escribir nada.
-- Las columnas de fecha siguen siendo `timestamp` (sin zona) para no cambiar cómo el servidor guarda las horas.

-- ---------------------------------------------------------------------------
-- Personal
-- ---------------------------------------------------------------------------
create table if not exists usuarios (
  id             serial primary key,
  nombre         varchar(150) not null,
  email          varchar(150) not null unique,
  password_hash  varchar(255) not null,
  rol            varchar(50)  not null default 'asesora',
  activo         boolean      not null default true,
  codigo_asesora varchar(30)
);

-- ---------------------------------------------------------------------------
-- Clientes (incluye el acceso a la app móvil: clave_hash)
-- ---------------------------------------------------------------------------
create table if not exists clientes (
  id                        serial primary key,
  codigo_cliente            varchar(50),
  nombre                    varchar(150) not null,
  apellido                  varchar(150),
  telefono                  varchar(50),
  email                     varchar(150),
  empresa                   varchar(200),
  asesora_id                integer references usuarios(id) on delete set null,
  estado                    varchar(50)  not null default 'pending',
  estado_venezuela          varchar(80),
  fecha_primer_contacto     date,
  tipo_mercancia            varchar(180),
  cajas_packing_list        integer,
  cajas_en_china            integer,
  cajas_recibidas_venezuela integer,
  cbm_packing_list          numeric(12,3),
  cbm_real_china            numeric(12,3),
  observaciones             text,
  fecha_registro            timestamp not null default current_timestamp,
  fecha_actualizacion       timestamp not null default current_timestamp,
  clave_hash                text
);
create unique index if not exists ux_clientes_codigo_cliente on clientes(codigo_cliente);
create index if not exists idx_clientes_asesora on clientes(asesora_id);

-- ---------------------------------------------------------------------------
-- Contenedores y etiquetas
-- ---------------------------------------------------------------------------
create table if not exists contenedores (
  id             serial primary key,
  numero         varchar(100) not null unique,
  origen         varchar(150),
  fecha_salida   date,
  fecha_estimada date,
  fecha_llegada  date,
  estado         varchar(50) not null default 'prep',
  observaciones  text
);

create table if not exists etiquetas (
  id                        serial primary key,
  numero                    varchar(100) not null unique,
  cliente_id                integer references clientes(id) on delete cascade,
  contenedor_id             integer references contenedores(id) on delete set null,
  estado                    varchar(50) not null default 'prep',
  observaciones             text,
  lista                     boolean not null default false,
  tipo_mercancia            text,
  cajas_packing_list        integer,
  cajas_en_china            integer,
  cajas_recibidas_venezuela integer,
  cbm_packing_list          numeric(12,3),
  cbm_real_china            numeric(12,3),
  familia_codigo            varchar(80),
  etiqueta_padre_id         integer references etiquetas(id) on delete cascade,
  tiene_subetiquetas        boolean not null default false,
  fecha_llegada_china       date,
  fecha_salida_china        date,
  fecha_creacion            timestamp not null default current_timestamp,
  fecha_actualizacion       timestamp not null default current_timestamp
);
create index if not exists idx_etiquetas_cliente    on etiquetas(cliente_id);
create index if not exists idx_etiquetas_contenedor on etiquetas(contenedor_id);
create index if not exists idx_etiquetas_padre      on etiquetas(etiqueta_padre_id);
create index if not exists idx_etiquetas_familia    on etiquetas(familia_codigo);

-- ---------------------------------------------------------------------------
-- Operación interna
-- ---------------------------------------------------------------------------
create table if not exists historial (
  id             serial primary key,
  usuario_id     integer references usuarios(id) on delete set null,
  accion         varchar(200),
  tabla_afectada varchar(100),
  registro_id    integer,
  descripcion    text,
  fecha          timestamp default current_timestamp
);
create index if not exists idx_historial_fecha on historial(fecha desc);

create table if not exists recordatorios (
  id             serial primary key,
  titulo         varchar(200) not null,
  notas          text,
  cliente_id     integer references clientes(id) on delete set null,
  asesora_id     integer references usuarios(id) on delete set null,
  fecha_hora     timestamp not null,
  completado     boolean not null default false,
  creado_por     integer references usuarios(id) on delete set null,
  fecha_creacion timestamp not null default current_timestamp
);
create index if not exists idx_recordatorios_asesora on recordatorios(asesora_id, fecha_hora);

create table if not exists quejas (
  id               serial primary key,
  usuario_id       integer references usuarios(id) on delete set null,
  asunto           varchar(200) not null,
  detalle          text not null,
  prioridad        varchar(30) not null default 'normal',
  estado           varchar(30) not null default 'pendiente',
  respuesta        text,
  creado_en        timestamp not null default current_timestamp,
  respondido_en    timestamp,
  fecha_incidencia date,
  codigo_asesor    varchar(50),
  codigo_cliente   varchar(50),
  codigo_etiqueta  varchar(50),
  area_involucrada varchar(100),
  evidencia        text
);
create index if not exists idx_quejas_usuario on quejas(usuario_id);

create table if not exists queja_archivos (
  id              serial primary key,
  queja_id        integer not null references quejas(id) on delete cascade,
  nombre_original varchar(255) not null,
  nombre_guardado varchar(255) not null,
  mime_type       varchar(150) not null,
  tamano          bigint not null default 0,
  creado_en       timestamp not null default current_timestamp
);
create index if not exists idx_queja_archivos_queja on queja_archivos(queja_id);

create table if not exists notas_equipo (
  id         serial primary key,
  usuario_id integer references usuarios(id) on delete set null,
  texto      text not null,
  creado_en  timestamp not null default current_timestamp
);

-- ---------------------------------------------------------------------------
-- App móvil de clientes
-- ---------------------------------------------------------------------------
create table if not exists etiqueta_lotes (
  id          serial primary key,
  etiqueta_id integer not null references etiquetas(id) on delete cascade,
  nombre      varchar(80) not null,
  cajas       integer not null check (cajas > 0),
  kg_por_caja numeric(10,2) not null check (kg_por_caja > 0),
  largo_cm    numeric(10,2),
  ancho_cm    numeric(10,2),
  alto_cm     numeric(10,2)
);
create index if not exists idx_etiqueta_lotes_etiqueta on etiqueta_lotes(etiqueta_id);

-- El archivo vive en el almacén de archivos (hoy disco local uploads/etiquetas; ver supabase/README.md sobre Storage).
create table if not exists etiqueta_fotos (
  id              serial primary key,
  etiqueta_id     integer not null references etiquetas(id) on delete cascade,
  titulo          varchar(120),
  lugar           varchar(120),
  nombre_guardado varchar(255) not null,
  mime_type       varchar(100) not null,
  creado_en       timestamp not null default current_timestamp
);
create index if not exists idx_etiqueta_fotos_etiqueta on etiqueta_fotos(etiqueta_id);

create table if not exists cliente_preferencias (
  cliente_id integer primary key references clientes(id) on delete cascade,
  almacen    boolean not null default true,
  transito   boolean not null default true,
  puerto     boolean not null default true,
  fotos      boolean not null default false
);

create table if not exists cliente_dispositivos (
  id         serial primary key,
  cliente_id integer not null references clientes(id) on delete cascade,
  push_token varchar(255) not null unique,
  plataforma varchar(20),
  creado_en  timestamp not null default current_timestamp
);
create index if not exists idx_cliente_dispositivos_cliente on cliente_dispositivos(cliente_id);

create table if not exists cliente_avisos (
  id          serial primary key,
  cliente_id  integer not null references clientes(id) on delete cascade,
  etiqueta_id integer references etiquetas(id) on delete set null,
  titulo      varchar(200) not null,
  cuerpo      text not null,
  creado_en   timestamp not null default current_timestamp
);
create index if not exists idx_cliente_avisos_cliente on cliente_avisos(cliente_id, id desc);

-- ---------------------------------------------------------------------------
-- Seguridad: RLS activado sin políticas + sin permisos para los roles de la API pública de Supabase.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'usuarios','clientes','contenedores','etiquetas','historial','recordatorios','quejas','queja_archivos',
    'notas_equipo','etiqueta_lotes','etiqueta_fotos','cliente_preferencias','cliente_dispositivos','cliente_avisos'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;

  -- En Supabase existen estos roles; en un Postgres común (pruebas locales) no, por eso la guarda.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;       -- tablas futuras también
    alter default privileges in schema public revoke all on sequences from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
  end if;
end $$;

-- Bucket privado para las fotos de las etiquetas (solo existe en Supabase). Hoy el servidor aún guarda en disco.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('etiquetas-fotos', 'etiquetas-fotos', false)
    on conflict (id) do nothing;
  end if;
end $$;
