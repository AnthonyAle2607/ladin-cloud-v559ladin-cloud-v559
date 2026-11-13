# Código de cliente correlativo (CC-001, CC-002…)

Migración: `supabase/migrations/20261115000000_codigo_cliente_cc.sql` (se puede aplicar varias veces).

- Igual que las etiquetas: cada cliente nuevo recibe el siguiente código `CC-###` (CC-001, CC-002… y desde el 1000,
  CC-1000). Lo hace `codigos.js` en todas las vías: «Nuevo cliente», «Importar datos» y «Contactos por asignar».
- Si al crear el cliente se escribe un código a mano, se respeta. Si se deja vacío, lo pone el sistema.
- Si dos clientes se crean a la vez, el que choca toma el siguiente número.

## Clientes que ya existían

- La migración renumera a todos los que no tienen `CC-###`, por orden de registro, a continuación del mayor CC que ya
  exista. La segunda vez no cambia nada.
- El código viejo queda en `clientes.codigo_anterior`.
- **App móvil:** el cliente puede entrar con su código nuevo (CC-###) o con el anterior; la clave no cambia.
