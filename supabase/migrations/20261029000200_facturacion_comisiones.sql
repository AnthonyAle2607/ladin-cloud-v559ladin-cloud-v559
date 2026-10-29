-- Facturación de servicios, pagos y comisiones por asesor. Mismo criterio de seguridad que el esquema inicial:
-- RLS activado sin políticas (solo el servidor entra) y sin permisos para anon/authenticated.
-- Las facturas no se borran: un cliente con facturas no se puede eliminar (ON DELETE RESTRICT) y se anulan con estado.

create table if not exists facturas (
  id                     serial primary key,
  codigo                 varchar(40) unique,
  cliente_id             integer not null references clientes(id) on delete restrict,
  asesora_id             integer references usuarios(id) on delete set null,
  fecha_factura          date not null,
  fecha_pedido           date,
  fecha_carga            date,
  fecha_estimada_llegada date,
  direccion              varchar(250),
  metodo_envio           varchar(100),
  metodo_pago            varchar(100),
  modo_entrega           varchar(100),
  forma_declarar         varchar(100),
  otros_servicios        varchar(250),
  observaciones          text,
  total                  numeric(12,2) not null default 0 check (total >= 0),
  pagado                 numeric(12,2) not null default 0 check (pagado >= 0),
  estado                 varchar(20) not null default 'emitida' check (estado in ('emitida','anulada')),
  creado_por             integer references usuarios(id) on delete set null,
  fecha_creacion         timestamp not null default current_timestamp
);
create index if not exists idx_facturas_cliente on facturas(cliente_id);
create index if not exists idx_facturas_asesora on facturas(asesora_id, id desc);

create table if not exists factura_items (
  id                serial primary key,
  factura_id        integer not null references facturas(id) on delete cascade,
  etiqueta_id       integer references etiquetas(id) on delete set null,
  descripcion       varchar(250) not null,
  cajas             integer not null default 0 check (cajas >= 0),
  cbm               numeric(12,3) not null default 0 check (cbm >= 0),
  peso              numeric(12,2) not null default 0 check (peso >= 0),
  tarifa_maritima   numeric(10,2) not null default 660 check (tarifa_maritima >= 0),
  volumen_terrestre numeric(12,3) not null default 0 check (volumen_terrestre >= 0),
  tarifa_terrestre  numeric(10,2) not null default 0 check (tarifa_terrestre >= 0),
  extra             numeric(10,2) not null default 0 check (extra >= 0),
  monto             numeric(12,2) not null default 0 check (monto >= 0)
);
create index if not exists idx_factura_items_factura  on factura_items(factura_id);
create index if not exists idx_factura_items_etiqueta on factura_items(etiqueta_id);

create table if not exists factura_pagos (
  id             serial primary key,
  factura_id     integer not null references facturas(id) on delete cascade,
  fecha          date not null,
  monto          numeric(12,2) not null check (monto > 0),
  metodo         varchar(100),
  referencia     varchar(150),
  creado_por     integer references usuarios(id) on delete set null,
  fecha_creacion timestamp not null default current_timestamp
);
create index if not exists idx_factura_pagos_factura on factura_pagos(factura_id);

-- Regla de comisión: una por asesor y, con asesora_id nulo, la global que se aplica a quien no tenga la suya.
create table if not exists comision_reglas (
  id         serial primary key,
  asesora_id integer unique references usuarios(id) on delete cascade,
  tipo       varchar(30) not null check (tipo in ('porcentaje_total','porcentaje_flete','fijo_cbm')),
  valor      numeric(10,3) not null default 0 check (valor >= 0)
);
-- Solo puede existir una regla global (el unique de arriba no distingue los nulos).
create unique index if not exists ux_comision_regla_global on comision_reglas ((asesora_id is null)) where asesora_id is null;

-- Una comisión por factura, con la regla y la tasa que se usaron al emitirla.
create table if not exists comisiones (
  id             serial primary key,
  factura_id     integer not null unique references facturas(id) on delete cascade,
  asesora_id     integer references usuarios(id) on delete set null,
  cliente_id     integer references clientes(id) on delete set null,
  base           numeric(12,3) not null default 0,
  regla          varchar(30) not null,
  tasa           numeric(10,3) not null default 0,
  monto          numeric(12,2) not null default 0 check (monto >= 0),
  estado         varchar(20) not null default 'pendiente' check (estado in ('pendiente','pagada','anulada')),
  fecha_pago     date,
  pagado_por     integer references usuarios(id) on delete set null,
  fecha_creacion timestamp not null default current_timestamp
);
create index if not exists idx_comisiones_asesora on comisiones(asesora_id, estado);

do $$
declare t text;
begin
  foreach t in array array['facturas','factura_items','factura_pagos','comision_reglas','comisiones'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
  end if;
end $$;
