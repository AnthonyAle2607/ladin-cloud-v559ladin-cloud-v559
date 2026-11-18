-- «Directo de China»: catálogo de 1688 en vivo en la web a través de OTAPI (catalogo-china.js).
-- china_cache guarda las respuestas (búsquedas y fichas 6 h, categorías 7 días) para no pagar la misma consulta dos veces.
-- china_uso cuenta las llamadas pagadas de cada día (tope CHINA_LLAMADAS_DIA). Se puede aplicar varias veces.

create table if not exists public.china_cache (
  clave varchar(300) primary key,
  valor text not null,
  expira timestamp not null
);
create index if not exists china_cache_expira_idx on public.china_cache (expira);

create table if not exists public.china_uso (
  dia date primary key,
  llamadas integer not null default 0
);

alter table public.china_cache enable row level security;
alter table public.china_uso enable row level security;
