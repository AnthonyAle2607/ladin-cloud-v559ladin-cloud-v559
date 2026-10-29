-- Cédula o RIF del cliente: se captura en el panel y se muestra al cliente en la app móvil («Mis datos»).
-- El servidor también la agrega al arrancar (ALTER ... IF NOT EXISTS); este archivo deja constancia y sirve para aplicarla a mano.
alter table clientes add column if not exists cedula varchar(30);
