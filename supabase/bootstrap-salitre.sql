-- EJECUCIÓN MANUAL PRIVILEGIADA, nunca en CI ni automáticamente en migraciones.
-- Requiere que las migraciones estén revisadas y aplicadas. No cambia Sanity.
begin;
do $$
declare r uuid;
begin
 if exists(select 1 from public.restaurants where slug='salitre') then
 raise exception 'Salitre ya existe: revisar, no sobrescribir';end if;
 insert into public.restaurants(name,slug,status) values('Salitre','salitre','active') returning id into r;
 insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values(r,'content_management',true);
 insert into public.restaurant_modules(restaurant_id,module_key,enabled) values(r,'content_management',true);
 insert into public.restaurant_integrations(restaurant_id,provider,external_project_id,external_dataset) values(r,'sanity','hfa8zkyw','production');
end;$$;
commit;
-- Asignar primer administrador SOLO tras crear/invitar un usuario real:
-- insert into app_private.platform_administrators(user_id) values ('UUID_REAL');
-- La membresía de Salitre se asigna explícitamente con admin_configure.
