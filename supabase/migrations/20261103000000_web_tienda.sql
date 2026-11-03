-- Web pública de Criollo Cargo (zarpes, rastreo, cotizador, solicitudes) y tienda en preventa.
-- Las mismas tablas las crea el servidor al arrancar (web-publica.js y tienda.js); esta migración añade llaves
-- foráneas, validaciones y el bloqueo de acceso directo desde el navegador.

-- Contenedores: lo que muestra el tablero de zarpes de la web.
alter table contenedores add column if not exists publicar_web boolean not null default false;
alter table contenedores add column if not exists fecha_cierre date;
alter table contenedores add column if not exists capacidad_cbm numeric(8,2) not null default 68;
alter table contenedores add column if not exists ruta varchar(120);

create table if not exists web_solicitudes (
  id serial primary key,
  tipo varchar(20) not null check (tipo in ('reserva', 'contacto', 'aviso_producto')),
  nombre varchar(150) not null,
  telefono varchar(50),
  email varchar(150),
  estado_venezuela varchar(80),
  mensaje text,
  datos text,
  producto_id integer,
  atendida boolean not null default false,
  atendida_por integer references usuarios(id) on delete set null,
  creado_en timestamp not null default current_timestamp
);
create index if not exists web_solicitudes_atendida_idx on web_solicitudes(atendida, creado_en);

create table if not exists tienda_categorias (
  id serial primary key,
  nombre varchar(80) not null,
  slug varchar(80) not null unique,
  orden integer not null default 0,
  activa boolean not null default true
);

create table if not exists tienda_productos (
  id serial primary key,
  slug varchar(90) not null unique,
  nombre varchar(150) not null,
  categoria_id integer references tienda_categorias(id) on delete set null,
  origen varchar(120),
  descripcion text,
  especificaciones text,
  precio_usd numeric(10,2) not null check (precio_usd > 0),
  precio_antes_usd numeric(10,2),
  nombre_variante varchar(40) not null default 'Presentación',
  contenedor_id integer references contenedores(id) on delete set null,
  orden integer not null default 0,
  activo boolean not null default false,
  creado_en timestamp not null default current_timestamp,
  actualizado_en timestamp not null default current_timestamp
);

create table if not exists tienda_variantes (
  id serial primary key,
  producto_id integer not null references tienda_productos(id) on delete cascade,
  nombre varchar(80) not null,
  sku varchar(60),
  cupo integer not null default 0 check (cupo >= 0),
  precio_usd numeric(10,2),
  orden integer not null default 0,
  activa boolean not null default true
);
create index if not exists tienda_variantes_producto_idx on tienda_variantes(producto_id);

create table if not exists tienda_imagenes (
  id serial primary key,
  producto_id integer not null references tienda_productos(id) on delete cascade,
  nombre_guardado varchar(255) not null,
  mime_type varchar(60) not null,
  almacen varchar(10) not null default 'disco' check (almacen in ('disco', 'supabase')),
  orden integer not null default 0
);
create index if not exists tienda_imagenes_producto_idx on tienda_imagenes(producto_id);

create table if not exists tienda_destinos (
  id serial primary key,
  nombre varchar(80) not null,
  costo_usd numeric(10,2) not null default 0 check (costo_usd >= 0),
  dias_extra integer not null default 0 check (dias_extra >= 0),
  requiere_direccion boolean not null default true,
  orden integer not null default 0,
  activo boolean not null default true
);

create table if not exists tienda_pedidos (
  id serial primary key,
  numero varchar(20) unique,
  token_hash varchar(64) not null,
  nombre varchar(150) not null,
  telefono varchar(50) not null,
  email varchar(150),
  cedula varchar(30),
  destino_id integer references tienda_destinos(id) on delete set null,
  destino varchar(80),
  direccion text,
  estado varchar(20) not null default 'pendiente_pago'
    check (estado in ('pendiente_pago', 'pago_reportado', 'pagado', 'en_camino', 'entregado', 'cancelado', 'vencido')),
  subtotal_usd numeric(10,2) not null,
  envio_usd numeric(10,2) not null default 0,
  total_usd numeric(10,2) not null,
  metodo_pago varchar(20),
  referencia_pago varchar(120),
  pago_reportado_en timestamp,
  vence_en timestamp,
  cliente_id integer references clientes(id) on delete set null,
  notas text,
  creado_en timestamp not null default current_timestamp,
  actualizado_en timestamp not null default current_timestamp
);
create index if not exists tienda_pedidos_estado_idx on tienda_pedidos(estado, vence_en);

create table if not exists tienda_pedido_items (
  id serial primary key,
  pedido_id integer not null references tienda_pedidos(id) on delete cascade,
  producto_id integer references tienda_productos(id) on delete set null,
  variante_id integer references tienda_variantes(id) on delete set null,
  nombre varchar(150) not null,
  variante varchar(80),
  precio_usd numeric(10,2) not null,
  cantidad integer not null check (cantidad > 0),
  contenedor_id integer references contenedores(id) on delete set null
);
create index if not exists tienda_pedido_items_pedido_idx on tienda_pedido_items(pedido_id);

-- Fotos de productos: bucket privado; las sirve el servidor (/api/tienda/imagenes/:id).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('tienda', 'tienda', false)
    on conflict (id) do nothing;
  end if;
end $$;

-- Igual que el resto: solo el servidor (con la clave secreta) lee y escribe; el navegador nunca habla con la base.
do $$
declare
  t text;
begin
  foreach t in array array['web_solicitudes', 'tienda_categorias', 'tienda_productos', 'tienda_variantes', 'tienda_imagenes', 'tienda_destinos', 'tienda_pedidos', 'tienda_pedido_items'] loop
    execute format('alter table %I enable row level security', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on %I from anon', t);
      execute format('revoke all on sequence %I from anon', t || '_id_seq');
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on %I from authenticated', t);
      execute format('revoke all on sequence %I from authenticated', t || '_id_seq');
    end if;
  end loop;
end $$;
