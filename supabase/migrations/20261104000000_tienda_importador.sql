-- Importador de productos (importador-1688.js): de dónde salió cada producto y su costo de referencia.
-- Solo los ve el panel; la tienda pública no los expone.
alter table tienda_productos add column if not exists fuente_url text;
alter table tienda_productos add column if not exists costo_referencia text;
