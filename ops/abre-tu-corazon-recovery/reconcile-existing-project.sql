-- Preferred recovery: retain the known Sanity project and resume at the manual-admin pause.
-- Run inspect.sql first. The custom transaction setting is an intentional operator confirmation.
-- This script does not call Sanity, create tokens/datasets, or touch content.
do $$
declare child public.sanity_provisioning_jobs; parent_count integer;
begin
 if current_setting('app.abre_tu_corazon_confirmation',true)<>'RECONCILE-lvtvr3ef' then
  raise exception 'Explicit recovery confirmation missing';
 end if;
 select * into child from public.sanity_provisioning_jobs
  where request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid for update;
 if not found or child.restaurant_id<>'00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
    or child.integration_id<>'307ff26b-57a9-498c-9ee2-b798c2f5c290'::uuid
    or child.slug<>'abretucorazon' or child.project_id<>'ra138101d442db33'
    or child.status not in ('failed','manual_review')
    or child.stage not in ('queued','project_ready')
    or child.external_project_id is not null then
  raise exception 'Abre Tu Corazón state no longer matches the reviewed failure';
 end if;
 if exists(select 1 from public.sanity_provisioning_jobs where external_project_id='lvtvr3ef')
    or exists(select 1 from public.restaurant_integrations where external_project_id='lvtvr3ef') then
  raise exception 'The real Sanity project is already bound';
 end if;
 update public.sanity_provisioning_jobs
  set external_project_id='lvtvr3ef',status='awaiting',stage='awaiting_sanity_admin',
      retryable=false,error_code=null,lease_token=null,lease_expires_at=null
  where request_id=child.request_id;
 update public.restaurant_provisioning_jobs
  set status='awaiting',stage='sanity',retryable=false,error_code=null,
      lease_token=null,lease_expires_at=null
  where sanity_request_id=child.request_id and status in ('failed','manual_review');
 get diagnostics parent_count=row_count;
 if parent_count<>1 then raise exception 'Expected exactly one aggregate request, found %',parent_count; end if;
end $$;

-- Review these rows before COMMIT when running interactively.
select request_id,external_project_id,status,stage from public.sanity_provisioning_jobs
where request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid;
select request_id,status,stage from public.restaurant_provisioning_jobs
where sanity_request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid;
