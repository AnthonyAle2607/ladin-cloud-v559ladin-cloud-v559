-- Contactos por asignar: clientes traídos del sistema anterior (Ladin Cloud) con solo nombre y teléfono.
-- El administrador elige la asesora de cada uno; al asignarlo se crea como cliente de esa asesora.
-- Los datos NO van en esta migración: se cargan desde el panel (Contactos por asignar → Cargar archivo).
create table if not exists public.contactos_por_asignar (
  id             serial primary key,
  nombre         varchar(150) not null,
  apellido       varchar(150),
  telefono       varchar(50),
  telefono_norm  varchar(20),
  clave          varchar(220),  -- teléfono + nombre normalizados: evita cargar dos veces la misma persona
  origen         varchar(40) not null default 'ladincloud',
  estado         varchar(20) not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'descartado')),
  cliente_id     integer references public.clientes(id) on delete set null,
  asesora_id     integer,
  asignado_por   integer,
  asignado_en    timestamp,
  creado_en      timestamp not null default current_timestamp
);
-- Por si se aplicó una versión anterior de esta migración.
alter table public.contactos_por_asignar add column if not exists clave varchar(220);
drop index if exists public.contactos_por_asignar_tel_idx;
create unique index if not exists contactos_por_asignar_clave_idx on public.contactos_por_asignar(clave);
create index if not exists contactos_por_asignar_telnorm_idx on public.contactos_por_asignar(telefono_norm);
create index if not exists contactos_por_asignar_estado_idx on public.contactos_por_asignar(estado);

-- Solo el servidor (service role) entra a esta tabla.
alter table public.contactos_por_asignar enable row level security;
revoke all on public.contactos_por_asignar from anon, authenticated;
