-- Prepare one explicit dashboard retry after an operator verifies GitHub repository
-- 1444959693 and its template_repository 1441667450 with the read-only API checks
-- documented in README.md. This file never calls GitHub, Sanity or an Edge Function.
-- Run inside an explicit administrative transaction; this file does not COMMIT.
do $$
declare child public.astro_provisioning_jobs;
        parent public.restaurant_provisioning_jobs;
begin
 if current_setting('app.abre_tu_corazon_confirmation',true) is distinct from
    'RECONCILE-ASTRO-1444959693' then
  raise exception 'Explicit Astro recovery confirmation missing';
 end if;

 select * into child from public.astro_provisioning_jobs
  where request_id='7c0d6fd5-9534-4579-9062-96d3dc76eb08'::uuid for update;
 if not found
    or child.sanity_request_id<>'6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid
    or child.restaurant_id<>'00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
    or child.integration_id<>'307ff26b-57a9-498c-9ee2-b798c2f5c290'::uuid
    or lower(child.repository)<>'eduardocr90/abretucorazon-restaurant'
    or child.visibility<>'public'
    or child.site_url<>'https://eduardocr90.github.io/abretucorazon-restaurant/'
    or child.stage<>'queued'
    or child.error_code<>'repository_conflict'
    or child.repository_id is not null or child.specification_hash is not null
    or child.source_commit is not null or child.manifest_hash is not null
    or child.deployment_id is not null or child.lease_token is not null
    or not (
      (child.status='manual_review' and not child.retryable)
      or (child.status='failed' and child.retryable)
    ) then
  raise exception 'Astro job no longer matches the reviewed recoverable conflict';
 end if;

 select * into parent from public.restaurant_provisioning_jobs
  where request_id='594ef199-3f83-4d3d-9ffd-4fcc87f2c471'::uuid for update;
 if not found
    or parent.sanity_request_id<>child.sanity_request_id
    or parent.astro_request_id<>child.request_id
    or parent.restaurant_id<>child.restaurant_id
    or parent.integration_id<>child.integration_id
    or parent.stage<>'astro' or parent.error_code<>'astro'
    or parent.lease_token is not null
    or not (
      (parent.status='manual_review' and not parent.retryable)
      or (parent.status='failed' and parent.retryable)
    ) then
  raise exception 'Aggregate request no longer matches the reviewed Astro conflict';
 end if;

 if not exists(
  select 1 from public.sanity_provisioning_jobs s
  where s.request_id=child.sanity_request_id and s.restaurant_id=child.restaurant_id
    and s.integration_id=child.integration_id and s.external_project_id='lvtvr3ef'
    and s.dataset='production' and s.status='succeeded' and s.stage='completed'
 ) then
  raise exception 'Completed Sanity evidence changed; Astro recovery refused';
 end if;
 if exists(
  select 1 from public.astro_provisioning_jobs a
  where a.repository_id='1444959693' and a.request_id<>child.request_id
 ) or exists(
  select 1 from public.website_deployments d where d.repository_id='1444959693'
 ) or exists(
  select 1 from public.restaurant_websites w where w.restaurant_id=child.restaurant_id
 ) then
  raise exception 'Repository or website is already bound; automatic reconciliation refused';
 end if;

 update public.astro_provisioning_jobs
 set status='failed',retryable=true,error_code='repository_conflict',
     lease_token=null,lease_expires_at=null
 where request_id=child.request_id and status='manual_review';
 update public.restaurant_provisioning_jobs
 set status='failed',retryable=true,error_code='astro',
     lease_token=null,lease_expires_at=null
 where request_id=parent.request_id and status='manual_review';
end $$;

-- Review both rows before COMMIT. repository_id remains null intentionally: the
-- corrected Edge Function must verify GitHub and checkpoint ID/hash atomically.
select request_id,repository,repository_id,status,stage,retryable,error_code
from public.astro_provisioning_jobs
where request_id='7c0d6fd5-9534-4579-9062-96d3dc76eb08'::uuid;
select request_id,status,stage,retryable,error_code
from public.restaurant_provisioning_jobs
where request_id='594ef199-3f83-4d3d-9ffd-4fcc87f2c471'::uuid;
