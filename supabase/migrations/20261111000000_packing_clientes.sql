-- Packing lists que sube el CLIENTE desde la app móvil. La IA revisa que sea un packing list y guarda lo que leyó
-- (datos, JSON) para que la asesora lo compare con la etiqueta que llena a mano. Puede llegar sin etiqueta
-- (antes de que exista) y la asesora la vincula después.
create table if not exists public.packing_clientes (
  id              serial primary key,
  cliente_id      integer not null references public.clientes(id) on delete cascade,
  etiqueta_id     integer references public.etiquetas(id) on delete set null,
  nombre_original varchar(255),
  nombre_guardado varchar(255) not null,
  mime_type       varchar(120),
  tamano          integer not null default 0,
  almacen         varchar(10) not null default 'disco',
  revisado        boolean not null default false,
  datos           text,
  estado          varchar(20) not null default 'recibido' check (estado in ('recibido', 'descartado')),
  creado_en       timestamp not null default current_timestamp
);
create index if not exists packing_clientes_cliente_idx on public.packing_clientes(cliente_id);
create index if not exists packing_clientes_etiqueta_idx on public.packing_clientes(etiqueta_id);

-- Solo el servidor (service role) entra a esta tabla.
alter table public.packing_clientes enable row level security;
revoke all on public.packing_clientes from anon, authenticated;
