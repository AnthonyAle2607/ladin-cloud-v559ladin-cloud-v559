-- Cupo opcional en la tienda: una variante puede venderse «sin límite».
-- En la base «sin límite» es −1 (la API lo muestra como null). Con un número ≥ 0, cada pedido lo descuenta y en 0 se agota.

alter table public.tienda_variantes drop constraint if exists tienda_variantes_cupo_check;
alter table public.tienda_variantes add constraint tienda_variantes_cupo_check check (cupo >= -1);

-- Las variantes con cupo 0 que nunca se vendieron no estaban agotadas: era el valor con el que nacían (el importador y
-- el formulario creaban todo en 0). Pasan a «sin límite» para que se puedan comprar. Las que llegaron a 0 vendiendo
-- (tienen pedidos) siguen agotadas.
update public.tienda_variantes v
set cupo = -1
where v.cupo = 0
  and not exists (select 1 from public.tienda_pedido_items i where i.variante_id = v.id);
