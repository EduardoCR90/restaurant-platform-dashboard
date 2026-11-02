-- Phase 6.2: idempotent GitHub/Astro instance provisioning metadata.
-- Additive only: no repository, Pages, CMS or restaurant operation is executed by SQL.
begin;
create table public.astro_provisioning_jobs (
 request_id uuid primary key,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 sanity_request_id uuid not null unique references public.sanity_provisioning_jobs(request_id),
 restaurant_id uuid not null unique references public.restaurants(id),
 integration_id uuid not null unique references public.restaurant_integrations(id),
 template_key text not null,
 template_version text not null,
 source_template_commit text not null check(source_template_commit ~ '^[a-f0-9]{40}$'),
 distribution_hash text not null check(distribution_hash ~ '^[a-f0-9]{64}$'),
 visual jsonb not null check(jsonb_typeof(visual)='object'),
 modules jsonb not null check(jsonb_typeof(modules)='array' and jsonb_array_length(modules)<=6),
 custom_domain text check(custom_domain is null or custom_domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
 repository text not null unique check(repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
 repository_id text unique check(repository_id is null or repository_id ~ '^[1-9][0-9]+$'),
 visibility text not null check(visibility in ('private','public')),
 site_url text not null check(site_url ~ '^https://[A-Za-z0-9.-]+/'),
 base_path text not null check(base_path ~ '^/[A-Za-z0-9_.-]+$'),
 publication_endpoint text not null check(publication_endpoint ~ '^https://'),
 provisioning_endpoint text not null check(provisioning_endpoint ~ '^https://'),
 specification_hash text check(specification_hash is null or specification_hash ~ '^[a-f0-9]{64}$'),
 source_commit text check(source_commit is null or source_commit ~ '^[a-f0-9]{40}$'),
 manifest_hash text check(manifest_hash is null or manifest_hash ~ '^[a-f0-9]{64}$'),
 deployment_id uuid unique references public.website_deployments(id),
 status text not null default 'running' check(status in ('running','succeeded','failed','manual_review')),
 stage text not null default 'queued' check(stage in ('queued','repository_created','initialization_dispatched','source_ready','completed')),
 attempt_count integer not null default 1 check(attempt_count>0),
 retryable boolean not null default false,
 error_code text check(error_code is null or error_code in ('credentials','permissions','billing_or_quota','connection','repository_conflict','template_mismatch','provider_response','dispatch','manifest','pages','database')),
 lease_token uuid,
 lease_expires_at timestamptz,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(template_key,template_version) references public.template_releases(template_key,version),
 check((lease_token is null)=(lease_expires_at is null)),
 check((repository_id is null and specification_hash is null) or (repository_id is not null and specification_hash is not null)),
 check((source_commit is null)=(manifest_hash is null))
);
alter table public.astro_provisioning_jobs enable row level security;
revoke all on public.astro_provisioning_jobs from public,anon,authenticated;
grant all on public.astro_provisioning_jobs to service_role;
create trigger touch_updated_at before update on public.astro_provisioning_jobs for each row execute function app_private.touch_updated_at();

create function app_private.astro_provisioning_view(job public.astro_provisioning_jobs) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'request_id',job.request_id,'sanity_request_id',job.sanity_request_id,
  'restaurant_id',job.restaurant_id,'integration_id',job.integration_id,
  'name',r.name,'slug',r.slug,'project_id',i.external_project_id,'dataset',i.external_dataset,
  'template',to_jsonb(t),'visual',job.visual,'modules',job.modules,'custom_domain',job.custom_domain,
  'repository',job.repository,'repository_id',job.repository_id,'site_url',job.site_url,'base_path',job.base_path,
  'specification_hash',job.specification_hash,'source_commit',job.source_commit,'manifest_hash',job.manifest_hash,
  'deployment_id',job.deployment_id,'status',job.status,'stage',job.stage,
  'attempt_count',job.attempt_count,'retryable',job.retryable,'error_code',job.error_code,
  'created_at',job.created_at,'updated_at',job.updated_at)
 from public.restaurants r,public.restaurant_integrations i,public.template_releases t
 where r.id=job.restaurant_id and i.id=job.integration_id and
 t.template_key=job.template_key and t.version=job.template_version;$$;

create function public.admin_claim_astro_provisioning(actor uuid, operation text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs; sanity public.sanity_provisioning_jobs; release public.template_releases;
 request uuid; lease uuid; expected_repo text; repo_name text; owner text; module_count integer;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if operation not in ('start','retry') then raise exception 'Unsupported operation'; end if;
 request=(payload->>'request_id')::uuid;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if found then
  if operation='start' then
   if payload->>'request_hash' is not null and job.request_hash<>payload->>'request_hash' then raise exception 'Provisioning request changed'; end if;
   return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.astro_provisioning_view(job));
  end if;
  if job.status='succeeded' then return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.astro_provisioning_view(job)); end if;
  if job.status='manual_review' or (job.status='failed' and not job.retryable) then raise exception 'Provisioning requires review'; end if;
  if job.lease_token is not null and job.lease_expires_at>now() then raise exception 'Provisioning already running'; end if;
  if job.status='running' and job.stage not in ('initialization_dispatched','source_ready') then raise exception 'Provisioning already running'; end if;
  lease=gen_random_uuid();
  update public.astro_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 else
  if operation<>'start' or payload->>'request_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid provisioning request'; end if;
  select * into sanity from public.sanity_provisioning_jobs where request_id=(payload->>'sanity_request_id')::uuid for update;
  if not found or sanity.status<>'succeeded' or sanity.stage<>'completed' then raise exception 'Sanity provisioning is not complete'; end if;
  select * into release from public.template_releases where template_key=payload->>'template_key' and version=payload->>'template_version';
  if not found then raise exception 'Release not approved'; end if;
  owner=payload->>'repository_owner';
  if owner !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' or payload->>'visibility' not in ('private','public') then raise exception 'Invalid GitHub configuration'; end if;
  repo_name=case when length(sanity.slug||'-restaurant')<=100 then sanity.slug||'-restaurant' else regexp_replace(left(sanity.slug,89),'-+$','')||'-restaurant' end;
  expected_repo=owner||'/'||repo_name;
  if jsonb_typeof(payload->'visual')<>'object' or octet_length((payload->'visual')::text)>20000 or jsonb_typeof(payload->'modules')<>'array' or jsonb_array_length(payload->'modules')>6 then raise exception 'Invalid instance configuration'; end if;
  select count(*) into module_count from jsonb_array_elements(payload->'modules') m where
   m->>'key' in ('content_management','reservations','staff_scheduling','qr_menu','events','analytics') and
   jsonb_typeof(m->'granted')='boolean' and jsonb_typeof(m->'enabled')='boolean' and
   (not (m->>'enabled')::boolean or (m->>'granted')::boolean);
  if module_count<>jsonb_array_length(payload->'modules') or module_count<>(select count(distinct m->>'key') from jsonb_array_elements(payload->'modules') m) then raise exception 'Invalid modules'; end if;
  if payload->>'publication_endpoint' !~ '^https://' or payload->>'provisioning_endpoint' !~ '^https://' then raise exception 'Invalid callback endpoint'; end if;
  lease=gen_random_uuid();
  insert into public.astro_provisioning_jobs(request_id,request_hash,sanity_request_id,restaurant_id,integration_id,template_key,template_version,source_template_commit,distribution_hash,visual,modules,custom_domain,repository,visibility,site_url,base_path,publication_endpoint,provisioning_endpoint,lease_token,lease_expires_at,created_by)
   values(request,payload->>'request_hash',sanity.request_id,sanity.restaurant_id,sanity.integration_id,release.template_key,release.version,release.source_commit,release.distribution_hash,payload->'visual',payload->'modules',nullif(payload->>'custom_domain',''),expected_repo,payload->>'visibility','https://' || lower(owner) || '.github.io/' || repo_name || '/','/'||repo_name,payload->>'publication_endpoint',payload->>'provisioning_endpoint',lease,now()+interval '5 minutes',actor) returning * into job;
 end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'astro_provisioning_'||operation);
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.astro_provisioning_view(job));
end;$$;

create function public.admin_get_astro_provisioning(actor uuid, request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found then raise exception 'Provisioning unavailable'; end if;
 if job.status='running' and job.lease_token is not null and job.lease_expires_at<=now() then
  update public.astro_provisioning_jobs set status='failed',retryable=true,error_code='connection',lease_token=null,lease_expires_at=null where request_id=request returning * into job;
  insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'astro_provisioning_lease_expired');
 end if;
 return app_private.astro_provisioning_view(job);
end;$$;

create function public.admin_checkpoint_astro_provisioning(actor uuid, request uuid, lease uuid, next_stage text, evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Invalid provisioning lease'; end if;
 if job.stage='queued' and next_stage='repository_created' then
  if evidence->>'repository_id' !~ '^[1-9][0-9]+$' or evidence->>'specification_hash' !~ '^[a-f0-9]{64}$' then raise exception 'Invalid repository evidence'; end if;
  update public.astro_provisioning_jobs set stage=next_stage,repository_id=evidence->>'repository_id',specification_hash=evidence->>'specification_hash',lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 else raise exception 'Invalid provisioning transition'; end if;
 return app_private.astro_provisioning_view(job);
end;$$;

create function public.admin_await_astro_callback(actor uuid, request uuid, lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() or job.stage not in ('repository_created','initialization_dispatched') then raise exception 'Invalid provisioning lease'; end if;
 update public.astro_provisioning_jobs set stage='initialization_dispatched',lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 return app_private.astro_provisioning_view(job);
end;$$;

create function public.admin_confirm_astro_source(request uuid, repository_name text, repository_identity text, source text, manifest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs; lease uuid;
begin
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.status not in ('running','failed') or job.stage not in ('initialization_dispatched','source_ready') then raise exception 'Provisioning unavailable'; end if;
 if job.repository<>repository_name or job.repository_id<>repository_identity or source !~ '^[a-f0-9]{40}$' or manifest !~ '^[a-f0-9]{64}$' then raise exception 'Source identity mismatch'; end if;
 if job.stage='source_ready' and (job.source_commit<>source or job.manifest_hash<>manifest) then raise exception 'Source evidence changed'; end if;
 if job.stage='source_ready' and job.status='running' and job.lease_token is not null and job.lease_expires_at>now() then return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.astro_provisioning_view(job)); end if;
 lease=gen_random_uuid();
 update public.astro_provisioning_jobs set status='running',stage='source_ready',source_commit=source,manifest_hash=manifest,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.astro_provisioning_view(job));
end;$$;

create function public.admin_complete_astro_provisioning(actor uuid, request uuid, lease uuid, pages_url text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs; deployment uuid; module jsonb;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.stage<>'source_ready' or job.lease_token<>lease or job.lease_expires_at<=now() or pages_url<>job.site_url then raise exception 'Invalid provisioning completion'; end if;
 if not exists(select 1 from public.sanity_provisioning_jobs s join public.restaurant_integrations i on i.id=s.integration_id and i.restaurant_id=s.restaurant_id and i.external_project_id=s.project_id and i.external_dataset=s.dataset where s.request_id=job.sanity_request_id and s.status='succeeded' and s.restaurant_id=job.restaurant_id and s.integration_id=job.integration_id) then raise exception 'Sanity integration changed'; end if;
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

create function public.admin_fail_astro_provisioning(actor uuid, request uuid, lease uuid, code text, can_retry boolean, needs_review boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.astro_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if code not in ('credentials','permissions','billing_or_quota','connection','repository_conflict','template_mismatch','provider_response','dispatch','manifest','pages','database') then raise exception 'Invalid failure category'; end if;
 select * into job from public.astro_provisioning_jobs where request_id=request for update;
 if not found or job.lease_token<>lease then raise exception 'Invalid provisioning lease'; end if;
 update public.astro_provisioning_jobs set status=case when needs_review then 'manual_review' else 'failed' end,retryable=case when needs_review then false else can_retry end,error_code=code,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'astro_provisioning_failed_'||code);
 return app_private.astro_provisioning_view(job);
end;$$;

revoke all on function app_private.astro_provisioning_view(public.astro_provisioning_jobs) from public,anon,authenticated;
revoke all on function public.admin_claim_astro_provisioning(uuid,text,jsonb),public.admin_get_astro_provisioning(uuid,uuid),public.admin_checkpoint_astro_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_await_astro_callback(uuid,uuid,uuid),public.admin_confirm_astro_source(uuid,text,text,text,text),public.admin_complete_astro_provisioning(uuid,uuid,uuid,text),public.admin_fail_astro_provisioning(uuid,uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_claim_astro_provisioning(uuid,text,jsonb),public.admin_get_astro_provisioning(uuid,uuid),public.admin_checkpoint_astro_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_await_astro_callback(uuid,uuid,uuid),public.admin_confirm_astro_source(uuid,text,text,text,text),public.admin_complete_astro_provisioning(uuid,uuid,uuid,text),public.admin_fail_astro_provisioning(uuid,uuid,uuid,text,boolean,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
