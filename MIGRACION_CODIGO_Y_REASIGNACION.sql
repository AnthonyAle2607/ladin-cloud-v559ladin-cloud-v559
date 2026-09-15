-- Ladin Cloud: migración de códigos de cliente
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_cliente VARCHAR(50);
UPDATE clientes SET codigo_cliente = 'LC-CLI-' || LPAD(id::text, 6, '0') WHERE codigo_cliente IS NULL OR BTRIM(codigo_cliente) = '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_clientes_codigo_cliente ON clientes(codigo_cliente);

-- La reasignación de cartera se realiza desde la aplicación.
-- Las etiquetas no necesitan cambio de asesor: están vinculadas al cliente y lo siguen automáticamente.
