-- Phase 6.1: idempotent Sanity provisioning metadata and encrypted credentials.
-- This migration creates no external project, token, content or customer assignment.
begin;

create table public.sanity_provisioning_jobs (
 request_id uuid primary key,
 contract_version integer not null default 1 check(contract_version=1),
 content_contract text not null default 'salitre-v1' check(content_contract='salitre-v1'),
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 restaurant_id uuid not null unique references public.restaurants(id),
 integration_id uuid not null unique default gen_random_uuid(),
 name text not null check(length(name) between 1 and 120),
 slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 project_id text not null unique check(project_id ~ '^[a-z0-9]{5,16}$'),
 dataset text not null check(dataset='production'),
 status text not null check(status in ('running','succeeded','failed','manual_review')),
 stage text not null check(stage in ('queued','project_ready','dataset_ready','credential_pending','completed')),
 attempt_count integer not null default 1 check(attempt_count>0),
 retryable boolean not null default false,
 error_code text check(error_code in ('credentials','permissions','billing_or_quota','connection','provider_conflict','provider_response','credential_ambiguous','credential_storage','database')),
 lease_token uuid,
 lease_expires_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((status='running')=(lease_token is not null and lease_expires_at is not null)),
 check(status<>'succeeded' or (stage='completed' and error_code is null)),
 check(status<>'manual_review' or retryable=false)
);

create table public.integration_credentials (
 integration_id uuid primary key references public.restaurant_integrations(id),
 provider_token_id text not null unique check(length(provider_token_id) between 1 and 200),
 key_version text not null check(key_version ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
 ciphertext text not null check(ciphertext ~ '^[A-Za-z0-9_-]+$'),
 iv text not null check(iv ~ '^[A-Za-z0-9_-]+$'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.sanity_provisioning_jobs enable row level security;
alter table public.integration_credentials enable row level security;
revoke all on public.sanity_provisioning_jobs,public.integration_credentials from public,anon,authenticated;
grant all on public.sanity_provisioning_jobs,public.integration_credentials to service_role;
create trigger touch_updated_at before update on public.sanity_provisioning_jobs for each row execute function app_private.touch_updated_at();
create trigger touch_updated_at before update on public.integration_credentials for each row execute function app_private.touch_updated_at();

create function app_private.sanity_provisioning_view(job public.sanity_provisioning_jobs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'request_id',job.request_id,'restaurant_id',job.restaurant_id,'integration_id',job.integration_id,
  'name',job.name,'slug',job.slug,'project_id',job.project_id,'dataset',job.dataset,
  'status',job.status,'stage',job.stage,'attempt_count',job.attempt_count,
  'retryable',job.retryable,'error_code',job.error_code,
  'created_at',job.created_at,'updated_at',job.updated_at
 );
$$;

create function public.admin_claim_sanity_provisioning(actor uuid, operation text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs; restaurant uuid; lease uuid; request uuid;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if operation not in ('start','retry') then raise exception 'Unsupported operation'; end if;
 request=(payload->>'request_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if operation='start' then
  if payload->>'request_hash' !~ '^[a-f0-9]{64}$' or payload->>'name' is null or length(payload->>'name') not between 1 and 120 or payload->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or payload->>'project_id' !~ '^[a-z0-9]{5,16}$' or payload->>'dataset'<>'production' then raise exception 'Invalid provisioning request'; end if;
  if found then
   if job.request_hash<>payload->>'request_hash' then raise exception 'Idempotency conflict' using errcode='23505'; end if;
   return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.sanity_provisioning_view(job));
  end if;
  insert into public.restaurants(name,slug,status) values(payload->>'name',payload->>'slug','pending') returning id into restaurant;
  lease=gen_random_uuid();
  insert into public.sanity_provisioning_jobs(request_id,request_hash,restaurant_id,name,slug,project_id,dataset,status,stage,lease_token,lease_expires_at)
   values(request,payload->>'request_hash',restaurant,payload->>'name',payload->>'slug',payload->>'project_id','production','running','queued',lease,now()+interval '5 minutes') returning * into job;
 else
  if not found then raise exception 'Provisioning request not found'; end if;
  if not ((job.status='failed' and job.retryable) or (job.status='running' and job.lease_expires_at<=now())) then raise exception 'Provisioning request is not safely retryable'; end if;
  lease=gen_random_uuid();
  update public.sanity_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_'||operation);
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.sanity_provisioning_view(job));
end;$$;

create function public.admin_get_sanity_provisioning(actor uuid, request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found then raise exception 'Provisioning request not found'; end if;
 if job.status='running' and job.lease_expires_at<=now() then
  update public.sanity_provisioning_jobs set status='failed',retryable=true,error_code='connection',lease_token=null,lease_expires_at=null where request_id=request returning * into job;
  insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_lease_expired');
 end if;
 return app_private.sanity_provisioning_view(job);
end;$$;

create function public.admin_checkpoint_sanity_provisioning(actor uuid, request uuid, lease uuid, next_stage text) returns void
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 if not ((job.stage='queued' and next_stage='project_ready') or (job.stage='project_ready' and next_stage='dataset_ready') or (job.stage='dataset_ready' and next_stage='credential_pending')) then raise exception 'Invalid provisioning transition'; end if;
 update public.sanity_provisioning_jobs set stage=next_stage,lease_expires_at=now()+interval '5 minutes' where request_id=request;
end;$$;

create function public.admin_complete_sanity_provisioning(actor uuid, request uuid, lease uuid, provider_token text, credential jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.stage<>'credential_pending' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 if provider_token is null or length(provider_token) not between 1 and 200 or credential->>'key_version' !~ '^[a-z0-9][a-z0-9_-]{0,31}$' or credential->>'ciphertext' !~ '^[A-Za-z0-9_-]+$' or credential->>'iv' !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid encrypted credential'; end if;
 insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values(job.integration_id,job.restaurant_id,'sanity',job.project_id,job.dataset);
 insert into public.integration_credentials(integration_id,provider_token_id,key_version,ciphertext,iv) values(job.integration_id,provider_token,credential->>'key_version',credential->>'ciphertext',credential->>'iv');
 update public.sanity_provisioning_jobs set status='succeeded',stage='completed',retryable=false,error_code=null,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_completed');
 return app_private.sanity_provisioning_view(job);
end;$$;

create function public.admin_fail_sanity_provisioning(actor uuid, request uuid, lease uuid, code text, can_retry boolean, needs_review boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if code not in ('credentials','permissions','billing_or_quota','connection','provider_conflict','provider_response','credential_ambiguous','credential_storage','database') then raise exception 'Invalid error code'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 update public.sanity_provisioning_jobs set status=case when needs_review then 'manual_review' else 'failed' end,retryable=case when needs_review then false else can_retry end,error_code=code,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_failed_'||code);
 return app_private.sanity_provisioning_view(job);
end;$$;

revoke all on function app_private.sanity_provisioning_view(public.sanity_provisioning_jobs) from public,anon,authenticated;
revoke all on function public.admin_claim_sanity_provisioning(uuid,text,jsonb),public.admin_get_sanity_provisioning(uuid,uuid),public.admin_checkpoint_sanity_provisioning(uuid,uuid,uuid,text),public.admin_complete_sanity_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_fail_sanity_provisioning(uuid,uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_claim_sanity_provisioning(uuid,text,jsonb),public.admin_get_sanity_provisioning(uuid,uuid),public.admin_checkpoint_sanity_provisioning(uuid,uuid,uuid,text),public.admin_complete_sanity_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_fail_sanity_provisioning(uuid,uuid,uuid,text,boolean,boolean) to service_role;

notify pgrst, 'reload schema';
commit;
