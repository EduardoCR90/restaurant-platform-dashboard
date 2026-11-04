-- Read-only inventory for the Abre Tu Corazón Astro conflict.
-- This file does not acquire a provisioning lease or call any external provider.
select request_id,sanity_request_id,restaurant_id,integration_id,repository,repository_id,
       visibility,site_url,status,stage,attempt_count,retryable,error_code,
       specification_hash,source_commit,manifest_hash,deployment_id,
       lease_token is not null as has_lease,created_at,updated_at
from public.astro_provisioning_jobs
where request_id='7c0d6fd5-9534-4579-9062-96d3dc76eb08'::uuid;

select request_id,sanity_request_id,astro_request_id,restaurant_id,integration_id,
       repository,site_url,status,stage,attempt_count,retryable,error_code,
       lease_token is not null as has_lease,created_at,updated_at
from public.restaurant_provisioning_jobs
where request_id='594ef199-3f83-4d3d-9ffd-4fcc87f2c471'::uuid;

select request_id,restaurant_id,integration_id,external_project_id,status,stage,dataset
from public.sanity_provisioning_jobs
where request_id='6fa2ef1e-5427-4e04-9876-d0413843b1ea'::uuid;

select 'website_deployments' as dependency,count(*)::bigint as rows
from public.website_deployments
where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid
union all
select 'restaurant_websites',count(*)
from public.restaurant_websites
where restaurant_id='00ba7e95-9bd0-4df4-bd53-f76855c5e91f'::uuid;

-- Salitre is evidence only. No recovery statement may target this row.
select id,restaurant_id,external_project_id,external_dataset
from public.restaurant_integrations
where external_project_id='hfa8zkyw' and external_dataset='production';
