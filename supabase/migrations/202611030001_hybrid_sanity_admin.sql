-- Hybrid Sanity provisioning: persist provider IDs and pause for a verified administrator.
-- This migration performs no provider calls and does not alter Sanity content.
begin;

alter table public.sanity_provisioning_jobs
 add column external_project_id text unique
 check(external_project_id is null or external_project_id ~ '^[a-z0-9]{5,16}$');

-- Preserve successful jobs created by the previous contract when their integration is authoritative.
update public.sanity_provisioning_jobs j
 set external_project_id=i.external_project_id
 from public.restaurant_integrations i
 where j.status='succeeded' and i.id=j.integration_id and i.restaurant_id=j.restaurant_id
 and i.provider='sanity' and i.external_dataset=j.dataset and j.external_project_id is null;

alter table public.sanity_provisioning_jobs
 drop constraint sanity_provisioning_jobs_status_check,
 drop constraint sanity_provisioning_jobs_stage_check;
alter table public.sanity_provisioning_jobs
 add check(status in ('running','awaiting','succeeded','failed','manual_review')),
 add check(stage in ('queued','awaiting_sanity_admin','admin_verified','project_ready','dataset_ready','credential_pending','completed'));

create or replace function app_private.sanity_provisioning_view(job public.sanity_provisioning_jobs) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object(
  'request_id',job.request_id,'restaurant_id',job.restaurant_id,'integration_id',job.integration_id,
  'name',job.name,'slug',job.slug,'project_key',job.project_id,
  'project_id',job.external_project_id,
  'manage_url',case when job.external_project_id is null then null else 'https://www.sanity.io/manage/project/'||job.external_project_id end,
  'dataset',job.dataset,'status',job.status,'stage',job.stage,'attempt_count',job.attempt_count,
  'retryable',job.retryable,'error_code',job.error_code,
  'created_at',job.created_at,'updated_at',job.updated_at
 );
$$;

create or replace function public.admin_claim_sanity_provisioning(actor uuid, operation text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs; restaurant uuid; lease uuid; request uuid;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if operation not in ('start','retry','verify_admin') then raise exception 'Unsupported operation'; end if;
 request=(payload->>'request_id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if operation='start' then
  if payload->>'request_hash' !~ '^[a-f0-9]{64}$' or payload->>'name' is null or length(payload->>'name') not between 1 and 120 or payload->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or payload->>'project_id' !~ '^r[a-f0-9]{15}$' or payload->>'dataset'<>'production' then raise exception 'Invalid provisioning request'; end if;
  if found then
   if job.request_hash<>payload->>'request_hash' then raise exception 'Idempotency conflict' using errcode='23505'; end if;
   return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.sanity_provisioning_view(job));
  end if;
  insert into public.restaurants(name,slug,status) values(payload->>'name',payload->>'slug','pending') returning id into restaurant;
  lease=gen_random_uuid();
  insert into public.sanity_provisioning_jobs(request_id,request_hash,restaurant_id,name,slug,project_id,dataset,status,stage,lease_token,lease_expires_at)
   values(request,payload->>'request_hash',restaurant,payload->>'name',payload->>'slug',payload->>'project_id','production','running','queued',lease,now()+interval '5 minutes') returning * into job;
 elsif not found then raise exception 'Provisioning request not found';
 elsif operation='retry' then
  if not ((job.status='failed' and job.retryable) or (job.status='running' and job.lease_expires_at<=now())) then raise exception 'Provisioning request is not safely retryable'; end if;
  lease=gen_random_uuid();
  update public.sanity_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 else
  if job.status<>'awaiting' or job.stage<>'awaiting_sanity_admin' or job.external_project_id is null or job.lease_token is not null then raise exception 'Administrator verification is not available'; end if;
  lease=gen_random_uuid();
  update public.sanity_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_'||operation);
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.sanity_provisioning_view(job));
end;$$;

create function public.admin_pause_sanity_admin(actor uuid, request uuid, lease uuid, external_project text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if external_project !~ '^[a-z0-9]{5,16}$' then raise exception 'Invalid external project'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.stage<>'queued' or job.lease_token<>lease or job.lease_expires_at<=now() or (job.external_project_id is not null and job.external_project_id<>external_project) then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 update public.sanity_provisioning_jobs set external_project_id=external_project,status='awaiting',stage='awaiting_sanity_admin',retryable=false,error_code=null,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_awaiting_admin');
 return app_private.sanity_provisioning_view(job);
end;$$;

create function public.admin_wait_sanity_admin(actor uuid, request uuid, lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.sanity_provisioning_jobs set status='awaiting',retryable=false,error_code=null,lease_token=null,lease_expires_at=null
 where request_id=request and status='running' and stage='awaiting_sanity_admin' and lease_token=lease returning * into job;
 if not found then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_admin_not_ready');
 return app_private.sanity_provisioning_view(job);
end;$$;

create or replace function public.admin_checkpoint_sanity_provisioning(actor uuid, request uuid, lease uuid, next_stage text) returns void
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 if not ((job.stage='awaiting_sanity_admin' and next_stage='admin_verified') or (job.stage in ('admin_verified','project_ready') and next_stage='dataset_ready') or (job.stage='dataset_ready' and next_stage='credential_pending')) then raise exception 'Invalid provisioning transition'; end if;
 update public.sanity_provisioning_jobs set stage=next_stage,lease_expires_at=now()+interval '5 minutes' where request_id=request;
end;$$;

create or replace function public.admin_complete_sanity_provisioning(actor uuid, request uuid, lease uuid, provider_token text, credential jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.sanity_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.sanity_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.stage<>'credential_pending' or job.external_project_id is null or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Provisioning lease unavailable' using errcode='40001'; end if;
 if provider_token is null or length(provider_token) not between 1 and 200 or credential->>'key_version' !~ '^[a-z0-9][a-z0-9_-]{0,31}$' or credential->>'ciphertext' !~ '^[A-Za-z0-9_-]+$' or credential->>'iv' !~ '^[A-Za-z0-9_-]+$' then raise exception 'Invalid encrypted credential'; end if;
 insert into public.restaurant_integrations(id,restaurant_id,provider,external_project_id,external_dataset) values(job.integration_id,job.restaurant_id,'sanity',job.external_project_id,job.dataset);
 insert into public.integration_credentials(integration_id,provider_token_id,key_version,ciphertext,iv) values(job.integration_id,provider_token,credential->>'key_version',credential->>'ciphertext',credential->>'iv');
 update public.sanity_provisioning_jobs set status='succeeded',stage='completed',retryable=false,error_code=null,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'sanity_provisioning_completed');
 return app_private.sanity_provisioning_view(job);
end;$$;

create function public.admin_resume_restaurant_sanity_admin(actor uuid, request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs; child public.sanity_provisioning_jobs; lease uuid;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'awaiting' or job.stage<>'sanity' or job.lease_token is not null then raise exception 'Administrator verification is not available'; end if;
 select * into child from public.sanity_provisioning_jobs where request_id=job.sanity_request_id;
 if not found or child.status<>'awaiting' or child.stage<>'awaiting_sanity_admin' or child.external_project_id is null then raise exception 'Sanity administrator verification is not available'; end if;
 lease=gen_random_uuid();
 update public.restaurant_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'restaurant_provisioning_verify_sanity_admin');
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.restaurant_provisioning_view(job));
end;$$;

revoke all on function public.admin_pause_sanity_admin(uuid,uuid,uuid,text),public.admin_wait_sanity_admin(uuid,uuid,uuid),public.admin_resume_restaurant_sanity_admin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_pause_sanity_admin(uuid,uuid,uuid,text),public.admin_wait_sanity_admin(uuid,uuid,uuid),public.admin_resume_restaurant_sanity_admin(uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
