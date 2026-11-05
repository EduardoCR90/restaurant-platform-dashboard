-- Align Astro completion with the hybrid Sanity contract.
-- The request project_id is an internal idempotency key; external_project_id is the provider ID.
-- This migration only replaces one SECURITY DEFINER function and does not mutate tenant data.
begin;

create or replace function public.admin_complete_astro_provisioning(actor uuid, request uuid, lease uuid, pages_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs; deployment uuid; module jsonb;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.stage<>'source_ready' or job.lease_token<>lease or job.lease_expires_at<=now() or pages_url<>job.site_url then raise exception 'Invalid provisioning completion'; end if;
 if not exists(select 1 from public.sanity_provisioning_jobs s join public.restaurant_integrations i on i.id=s.integration_id and i.restaurant_id=s.restaurant_id and i.external_project_id=coalesce(s.external_project_id,s.project_id) and i.external_dataset=s.dataset where s.request_id=job.sanity_request_id and s.status='succeeded' and s.stage='completed' and s.restaurant_id=job.restaurant_id and s.integration_id=job.integration_id) then raise exception 'Sanity integration changed'; end if;
 insert into public.website_deployments(restaurant_id,integration_id,project_id,dataset,repository,repository_id,site_url)
  select job.restaurant_id,job.integration_id,i.external_project_id,i.external_dataset,job.repository,job.repository_id,job.site_url from public.restaurant_integrations i where i.id=job.integration_id returning id into deployment;
 insert into public.restaurant_websites(restaurant_id,deployment_id,desired_template_key,desired_version,custom_domain,custom_domain_status)
  values(job.restaurant_id,deployment,job.template_key,job.template_version,job.custom_domain,'unverified');
 for module in select * from jsonb_array_elements(job.modules) loop
  insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values(job.restaurant_id,module->>'key',(module->>'granted')::boolean);
  insert into public.restaurant_modules(restaurant_id,module_key,enabled) values(job.restaurant_id,module->>'key',(module->>'enabled')::boolean);
 end loop;
 update public.astro_provisioning_jobs set status='succeeded',stage='completed',deployment_id=deployment,retryable=false,error_code=null,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'astro_provisioning_completed');
 return app_private.astro_provisioning_view(job);
end;$$;

revoke all on function public.admin_complete_astro_provisioning(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_complete_astro_provisioning(uuid,uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
commit;
