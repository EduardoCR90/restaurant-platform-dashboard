-- Read-only inventory for the first Abre Tu Corazón provisioning request.
-- Safe to run before deciding between reconciliation and a full reset.
select request_id,restaurant_id,integration_id,name,slug,project_id as project_key,
       external_project_id,status,stage,retryable,error_code,lease_token is not null as has_lease,
       created_at,updated_at
from public.sanity_provisioning_jobs
where request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid;

select request_id,status,stage,restaurant_id,integration_id,repository,site_url,error_code
from public.restaurant_provisioning_jobs
where sanity_request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid;

select id,name,slug,status from public.restaurants
where id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid;

select id,restaurant_id,provider,external_project_id,external_dataset
from public.restaurant_integrations
where id='307ff26b-57a9-498c-9ee2-b798c2f5c290'::uuid
   or restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid;

select 'astro_jobs' as dependency,count(*)::bigint as rows from public.astro_provisioning_jobs
 where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
union all select 'websites',count(*) from public.restaurant_websites where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
union all select 'deployments',count(*) from public.website_deployments where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
union all select 'memberships',count(*) from public.restaurant_memberships where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
union all select 'credentials',count(*) from public.integration_credentials where integration_id='307ff26b-57a9-498c-9ee2-b798c2f5c290'::uuid;

-- Explicit guard: the protected Salitre integration must remain present and unchanged.
select id,restaurant_id,external_project_id,external_dataset
from public.restaurant_integrations
where external_project_id='hfa8zkyw' and external_dataset='production';
