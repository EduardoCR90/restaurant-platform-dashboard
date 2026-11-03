-- Destructive database-only fallback. DO NOT run while Sanity project lvtvr3ef is retained:
-- a fresh request would create another external project. This never deletes external resources.
-- Run inspect.sql first and use only after explicit authorization and external-resource decision.
do $$
declare child public.sanity_provisioning_jobs;
begin
 if current_setting('app.abre_tu_corazon_confirmation',true)<>'DELETE-6fa2ef1e-ABRE-ONLY' then
  raise exception 'Explicit destructive confirmation missing';
 end if;
 select * into child from public.sanity_provisioning_jobs
  where request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid for update;
 if not found or child.restaurant_id<>'00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
    or child.integration_id<>'307ff26b-57a9-498c-9ee2-b798c2f5c290'::uuid
    or child.slug<>'abretucorazon' or child.project_id<>'ra138101d442db33' then
  raise exception 'Target identity mismatch';
 end if;
 if exists(select 1 from public.restaurant_integrations where restaurant_id=child.restaurant_id)
    or exists(select 1 from public.astro_provisioning_jobs where restaurant_id=child.restaurant_id)
    or exists(select 1 from public.restaurant_websites where restaurant_id=child.restaurant_id)
    or exists(select 1 from public.website_deployments where restaurant_id=child.restaurant_id)
    or exists(select 1 from public.restaurant_memberships where restaurant_id=child.restaurant_id) then
  raise exception 'Downstream dependencies exist; database reset refused';
 end if;
 if exists(select 1 from public.restaurant_integrations where external_project_id='hfa8zkyw') is false then
  raise exception 'Protected Salitre evidence is missing';
 end if;
 delete from public.restaurant_provisioning_jobs where sanity_request_id=child.request_id;
 delete from public.sanity_provisioning_jobs where request_id=child.request_id;
 delete from public.restaurants where id=child.restaurant_id and status='pending' and slug='abretucorazon';
 if found is false then raise exception 'Pending restaurant was not deleted'; end if;
end $$;
