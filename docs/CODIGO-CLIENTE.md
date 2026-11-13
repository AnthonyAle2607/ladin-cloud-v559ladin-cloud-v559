# Código de cliente: [SEDE][ORIGEN]-[TIPO]-[CORRELATIVO]

Ejemplo: `CCMI-G-0015`. Migración: `supabase/migrations/20261117000000_codigo_cliente_nomenclatura.sql`
(reemplaza a la 20261115 de CC-###, que se borró sin aplicarse).

| Parte | Letras | Valores |
|---|---|---|
| Sede (dónde se registró) | 2 | CC Caracas, VL Valencia, MC Maracaibo, BQ Barquisimeto |
| Origen de la carga | 2 | MI Miami, PN Panamá, CN China, ES España, CL Colombia |
| Tipo de mercancía | 1 | G general, T tecnología, I industrial, A alimentos, M medicamentos |
| Correlativo | 4 dígitos | 0001, 0002… (después de 9999 sigue 10000) |

- El **correlativo es único para todos los clientes**: no puede haber `CCMI-G-0015` y `VLCN-T-0015` a la vez.
- **Nuevo cliente:** se eligen sede, origen y tipo; el correlativo lo pone el sistema al guardar. Si se escribe un código
  a mano, se respeta (si su correlativo ya lo tiene otro cliente, avisa).
- **Editar cliente:** cambiar sede, origen o tipo rearma el código con el mismo correlativo.
- **Importación y «Contactos por asignar»:** usan los valores por defecto (CC + CN + G).
- **Catálogo:** el administrador agrega o cambia sedes, orígenes y tipos (por ejemplo MG Margarita, PO Puerto Ordaz)
  y los valores por defecto con «Editar sedes, orígenes y tipos…» en la ficha del cliente. Se guarda en
  `ajustes.codigo_cliente` (`GET/PUT /api/ajustes/codigo-cliente`).

## Clientes que ya existían

- La migración renumera a todos los que no siguen la nomenclatura, por orden de registro, como `CCCN-G-0001`,
  `CCCN-G-0002`… Luego se corrige la sede, el origen o el tipo de cada uno desde su ficha (el correlativo se mantiene).
- El código anterior queda en `clientes.codigo_anterior`. **App móvil:** el cliente puede entrar con el código nuevo
  o con el anterior; la clave no cambia.
