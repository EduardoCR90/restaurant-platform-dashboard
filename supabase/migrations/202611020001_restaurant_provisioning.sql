-- Phase 6.3: aggregate, idempotent restaurant provisioning and DNS guidance.
-- Additive only. SQL never calls Sanity, GitHub, DNS providers or Auth email APIs.
begin;

create table public.restaurant_provisioning_jobs (
 request_id uuid primary key,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 name text not null check(length(name) between 1 and 120),
 slug text not null check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 client_email text not null check(length(client_email)<=254 and client_email=lower(client_email)),
 client_role text not null check(client_role in ('restaurant_owner','restaurant_manager')),
 template_key text not null,
 template_version text not null,
 visual jsonb not null check(jsonb_typeof(visual)='object'),
 modules jsonb not null check(jsonb_typeof(modules)='array' and jsonb_array_length(modules)<=6),
 custom_domain text check(custom_domain is null or custom_domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
 domain_mode text check((custom_domain is null and domain_mode is null) or (custom_domain is not null and domain_mode in ('apex','subdomain'))),
 sanity_request_id uuid not null unique,
 astro_request_id uuid not null unique,
 restaurant_id uuid unique references public.restaurants(id),
 integration_id uuid unique references public.restaurant_integrations(id),
 invitation_id uuid unique references public.restaurant_invitations(id),
 client_user_id uuid references public.profiles(id),
 repository text unique check(repository is null or repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
 site_url text check(site_url is null or site_url ~ '^https://[A-Za-z0-9.-]+/'),
 status text not null default 'running' check(status in ('running','awaiting','succeeded','failed','manual_review')),
 stage text not null default 'sanity' check(stage in ('sanity','astro','client_invitation','completed')),
 attempt_count integer not null default 1 check(attempt_count>0),
 retryable boolean not null default false,
 error_code text check(error_code is null or error_code in ('configuration','sanity','astro','invitation','database')),
 lease_token uuid,
 lease_expires_at timestamptz,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(template_key,template_version) references public.template_releases(template_key,version),
 check((lease_token is null)=(lease_expires_at is null)),
 check((restaurant_id is null)=(integration_id is null)),
 check((repository is null)=(site_url is null))
);
create unique index restaurant_provisioning_slug on public.restaurant_provisioning_jobs(slug);
alter table public.restaurant_provisioning_jobs enable row level security;
revoke all on public.restaurant_provisioning_jobs from public,anon,authenticated;
grant all on public.restaurant_provisioning_jobs to service_role;
create trigger touch_updated_at before update on public.restaurant_provisioning_jobs for each row execute function app_private.touch_updated_at();

create table public.restaurant_domains (
 restaurant_id uuid primary key references public.restaurants(id),
 hostname text not null unique check(hostname ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
 mode text not null check(mode in ('apex','subdomain')),
 target text not null check(target ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
 status text not null default 'dns_pending' check(status in ('dns_pending','verified')),
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records) between 1 and 8),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.restaurant_domains enable row level security;
revoke all on public.restaurant_domains from public,anon,authenticated;
grant select on public.restaurant_domains to authenticated;
grant all on public.restaurant_domains to service_role;
create policy tenant_domain_read on public.restaurant_domains for select to authenticated
 using(public.is_platform_admin() or app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']));
create trigger touch_updated_at before update on public.restaurant_domains for each row execute function app_private.touch_updated_at();

create function app_private.restaurant_provisioning_view(job public.restaurant_provisioning_jobs) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'request_id',job.request_id,'name',job.name,'slug',job.slug,'client_email',job.client_email,'client_role',job.client_role,
  'template',jsonb_build_object('template_key',job.template_key,'version',job.template_version),
  'visual',job.visual,'modules',job.modules,
  'domain',case when job.custom_domain is null then null else jsonb_build_object('hostname',job.custom_domain,'mode',job.domain_mode) end,
  'sanity_request_id',job.sanity_request_id,'astro_request_id',job.astro_request_id,
  'restaurant_id',job.restaurant_id,'integration_id',job.integration_id,'invitation_id',job.invitation_id,'client_user_id',job.client_user_id,
  'repository',job.repository,'site_url',job.site_url,'status',job.status,'stage',job.stage,
  'attempt_count',job.attempt_count,'retryable',job.retryable,'error_code',job.error_code,
  'sanity',(select app_private.sanity_provisioning_view(s) from public.sanity_provisioning_jobs s where s.request_id=job.sanity_request_id),
  'astro',(select app_private.astro_provisioning_view(a) from public.astro_provisioning_jobs a where a.request_id=job.astro_request_id),
  'dns',(select jsonb_build_object('hostname',d.hostname,'mode',d.mode,'target',d.target,'status',d.status,'records',d.records) from public.restaurant_domains d where d.restaurant_id=job.restaurant_id),
  'created_at',job.created_at,'updated_at',job.updated_at);$$;

create function public.admin_claim_restaurant_provisioning(actor uuid, operation text, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs; request uuid; lease uuid; release public.template_releases; module_count integer;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if operation not in ('start','retry','status') then raise exception 'Unsupported operation'; end if;
 request=(payload->>'request_id')::uuid;
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if operation='start' then
  if found then
   if job.request_hash<>payload->>'request_hash' then raise exception 'Idempotency conflict' using errcode='23505'; end if;
   return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.restaurant_provisioning_view(job));
  end if;
  if payload->>'request_hash' !~ '^[a-f0-9]{64}$' or payload->>'name' is null or length(payload->>'name') not between 1 and 120 or payload->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or lower(payload->>'client_email')<>payload->>'client_email' or length(payload->>'client_email')>254 or payload->>'client_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or payload->>'client_role' not in ('restaurant_owner','restaurant_manager') then raise exception 'Invalid provisioning request'; end if;
  if exists(select 1 from public.restaurants r where r.slug=payload->>'slug') or exists(select 1 from public.restaurant_provisioning_jobs p where p.slug=payload->>'slug') then raise exception 'Restaurant slug unavailable' using errcode='23505'; end if;
  select * into release from public.template_releases where template_key=payload->>'template_key' and version=payload->>'template_version';
  if not found then raise exception 'Release not approved'; end if;
  if jsonb_typeof(payload->'visual')<>'object' or octet_length((payload->'visual')::text)>20000 or jsonb_typeof(payload->'modules')<>'array' or jsonb_array_length(payload->'modules')>6 then raise exception 'Invalid configuration'; end if;
  select count(*) into module_count from jsonb_array_elements(payload->'modules') m where m->>'key' in ('content_management','reservations','staff_scheduling','qr_menu','events','analytics') and jsonb_typeof(m->'granted')='boolean' and jsonb_typeof(m->'enabled')='boolean' and (not (m->>'enabled')::boolean or (m->>'granted')::boolean);
  if module_count<>jsonb_array_length(payload->'modules') or module_count<>(select count(distinct m->>'key') from jsonb_array_elements(payload->'modules') m) then raise exception 'Invalid modules'; end if;
  if nullif(payload->>'custom_domain','') is not null and ((payload->>'custom_domain') !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$' or payload->>'domain_mode' not in ('apex','subdomain')) then raise exception 'Invalid domain'; end if;
  lease=gen_random_uuid();
  insert into public.restaurant_provisioning_jobs(request_id,request_hash,name,slug,client_email,client_role,template_key,template_version,visual,modules,custom_domain,domain_mode,sanity_request_id,astro_request_id,lease_token,lease_expires_at,created_by)
   values(request,payload->>'request_hash',payload->>'name',payload->>'slug',payload->>'client_email',payload->>'client_role',release.template_key,release.version,payload->'visual',payload->'modules',nullif(payload->>'custom_domain',''),nullif(payload->>'domain_mode',''),(payload->>'sanity_request_id')::uuid,(payload->>'astro_request_id')::uuid,lease,now()+interval '5 minutes',actor) returning * into job;
 elsif not found then raise exception 'Provisioning request not found';
 elsif operation='retry' then
  if job.status<>'failed' or not job.retryable or (job.lease_token is not null and job.lease_expires_at>now()) then raise exception 'Provisioning is not safely retryable'; end if;
  lease=gen_random_uuid();
  update public.restaurant_provisioning_jobs set status='running',attempt_count=attempt_count+1,retryable=false,error_code=null,lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 else
  if job.status in ('succeeded','manual_review') or (job.status='failed' and not job.retryable) then return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.restaurant_provisioning_view(job)); end if;
  if job.status='failed' and job.retryable then return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.restaurant_provisioning_view(job)); end if;
  if job.lease_token is not null and job.lease_expires_at>now() then return jsonb_build_object('execute',false,'lease_token',null,'job',app_private.restaurant_provisioning_view(job)); end if;
  lease=gen_random_uuid();
  update public.restaurant_provisioning_jobs set status='running',lease_token=lease,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'restaurant_provisioning_'||operation);
 return jsonb_build_object('execute',true,'lease_token',lease,'job',app_private.restaurant_provisioning_view(job));
end;$$;

create function public.admin_list_restaurant_provisioning(actor uuid, maximum integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if maximum not between 1 and 50 then raise exception 'Invalid limit'; end if;
 return coalesce((select jsonb_agg(app_private.restaurant_provisioning_view(j) order by j.created_at desc) from (select * from public.restaurant_provisioning_jobs order by created_at desc limit maximum) j),'[]'::jsonb);
end;$$;

create function public.admin_checkpoint_restaurant_provisioning(actor uuid, request uuid, lease uuid, next_stage text, evidence jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if not found or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Invalid provisioning lease'; end if;
 if job.stage='sanity' and next_stage='astro' then
  if not exists(select 1 from public.sanity_provisioning_jobs s where s.request_id=job.sanity_request_id and s.status='succeeded' and s.stage='completed' and s.restaurant_id=(evidence->>'restaurant_id')::uuid and s.integration_id=(evidence->>'integration_id')::uuid) then raise exception 'Sanity evidence mismatch'; end if;
  update public.restaurant_provisioning_jobs set stage='astro',restaurant_id=(evidence->>'restaurant_id')::uuid,integration_id=(evidence->>'integration_id')::uuid,lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 elsif job.stage='astro' and next_stage='client_invitation' then
  if not exists(select 1 from public.astro_provisioning_jobs a where a.request_id=job.astro_request_id and a.status='succeeded' and a.stage='completed' and a.restaurant_id=job.restaurant_id and a.integration_id=job.integration_id and a.repository=evidence->>'repository' and a.site_url=evidence->>'site_url') then raise exception 'Astro evidence mismatch'; end if;
  update public.restaurant_provisioning_jobs set stage='client_invitation',repository=evidence->>'repository',site_url=evidence->>'site_url',lease_expires_at=now()+interval '5 minutes' where request_id=request returning * into job;
 else raise exception 'Invalid provisioning transition'; end if;
 return app_private.restaurant_provisioning_view(job);
end;$$;

create function public.admin_wait_restaurant_provisioning(actor uuid, request uuid, lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.restaurant_provisioning_jobs set status='awaiting',lease_token=null,lease_expires_at=null where request_id=request and lease_token=lease returning * into job;
 if not found then raise exception 'Invalid provisioning lease'; end if;
 return app_private.restaurant_provisioning_view(job);
end;$$;

create function public.admin_prepare_restaurant_invitation(actor uuid, request uuid, lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs; invitation uuid; existing uuid;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if not found or job.stage<>'client_invitation' or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() or job.restaurant_id is null then raise exception 'Invalid provisioning lease'; end if;
 if job.invitation_id is null then
  insert into public.restaurant_invitations(restaurant_id,email,role,invited_by) values(job.restaurant_id,job.client_email,job.client_role,actor) returning id into invitation;
  update public.restaurant_provisioning_jobs set invitation_id=invitation where request_id=request returning * into job;
 end if;
 select u.id into existing from auth.users u where lower(u.email)=job.client_email limit 1;
 if existing is not null then update public.restaurant_provisioning_jobs set client_user_id=existing where request_id=request returning * into job; end if;
 return app_private.restaurant_provisioning_view(job);
end;$$;

create function public.admin_complete_restaurant_provisioning(actor uuid, request uuid, lease uuid, client uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs; target text; records jsonb;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if not found or job.stage<>'client_invitation' or job.status<>'running' or job.lease_token<>lease or job.lease_expires_at<=now() then raise exception 'Invalid provisioning lease'; end if;
 if not exists(select 1 from auth.users u join public.profiles p on p.id=u.id and p.status='active' where u.id=client and lower(u.email)=job.client_email) then raise exception 'Client identity mismatch'; end if;
 if not exists(select 1 from public.sanity_provisioning_jobs s where s.request_id=job.sanity_request_id and s.status='succeeded' and s.restaurant_id=job.restaurant_id and s.integration_id=job.integration_id) or not exists(select 1 from public.astro_provisioning_jobs a join public.restaurant_websites w on w.restaurant_id=a.restaurant_id and w.deployment_id=a.deployment_id join public.website_deployments d on d.id=a.deployment_id and d.restaurant_id=a.restaurant_id and d.integration_id=a.integration_id where a.request_id=job.astro_request_id and a.status='succeeded' and a.restaurant_id=job.restaurant_id and a.integration_id=job.integration_id and a.repository=job.repository and a.site_url=job.site_url and d.repository=a.repository and d.site_url=a.site_url) then raise exception 'Provisioning evidence changed'; end if;
 insert into public.restaurant_memberships(restaurant_id,user_id,role,status) values(job.restaurant_id,client,job.client_role,'active') on conflict(restaurant_id,user_id) do update set role=excluded.role,status='active';
 update public.restaurant_invitations set user_id=client,status='sent' where id=job.invitation_id;
 update public.restaurants set status='active' where id=job.restaurant_id and status='pending';
 if not found then raise exception 'Restaurant status changed'; end if;
 if job.custom_domain is not null then
  target=lower(split_part(job.repository,'/',1))||'.github.io';
  if job.domain_mode='subdomain' then records=jsonb_build_array(jsonb_build_object('type','CNAME','name',job.custom_domain,'value',target));
  else records=jsonb_build_array(
   jsonb_build_object('type','A','name',job.custom_domain,'value','185.199.108.153'),jsonb_build_object('type','A','name',job.custom_domain,'value','185.199.109.153'),
   jsonb_build_object('type','A','name',job.custom_domain,'value','185.199.110.153'),jsonb_build_object('type','A','name',job.custom_domain,'value','185.199.111.153'),
   jsonb_build_object('type','AAAA','name',job.custom_domain,'value','2606:50c0:8000::153'),jsonb_build_object('type','AAAA','name',job.custom_domain,'value','2606:50c0:8001::153'),
   jsonb_build_object('type','AAAA','name',job.custom_domain,'value','2606:50c0:8002::153'),jsonb_build_object('type','AAAA','name',job.custom_domain,'value','2606:50c0:8003::153'));
  end if;
  insert into public.restaurant_domains(restaurant_id,hostname,mode,target,records) values(job.restaurant_id,job.custom_domain,job.domain_mode,target,records);
 end if;
 update public.restaurant_provisioning_jobs set status='succeeded',stage='completed',client_user_id=client,retryable=false,error_code=null,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'restaurant_provisioning_completed');
 return app_private.restaurant_provisioning_view(job);
end;$$;

create function public.admin_fail_restaurant_provisioning(actor uuid, request uuid, lease uuid, code text, can_retry boolean, needs_review boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.restaurant_provisioning_jobs;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 if code not in ('configuration','sanity','astro','invitation','database') then raise exception 'Invalid error code'; end if;
 select * into job from public.restaurant_provisioning_jobs where request_id=request for update;
 if not found or job.lease_token<>lease then raise exception 'Invalid provisioning lease'; end if;
 update public.restaurant_provisioning_jobs set status=case when needs_review then 'manual_review' else 'failed' end,retryable=case when needs_review then false else can_retry end,error_code=code,lease_token=null,lease_expires_at=null where request_id=request returning * into job;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,job.restaurant_id,'restaurant_provisioning_failed_'||code);
 return app_private.restaurant_provisioning_view(job);
end;$$;

revoke all on function app_private.restaurant_provisioning_view(public.restaurant_provisioning_jobs) from public,anon,authenticated;
revoke all on function public.admin_claim_restaurant_provisioning(uuid,text,jsonb),public.admin_list_restaurant_provisioning(uuid,integer),public.admin_checkpoint_restaurant_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_wait_restaurant_provisioning(uuid,uuid,uuid),public.admin_prepare_restaurant_invitation(uuid,uuid,uuid),public.admin_complete_restaurant_provisioning(uuid,uuid,uuid,uuid),public.admin_fail_restaurant_provisioning(uuid,uuid,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_claim_restaurant_provisioning(uuid,text,jsonb),public.admin_list_restaurant_provisioning(uuid,integer),public.admin_checkpoint_restaurant_provisioning(uuid,uuid,uuid,text,jsonb),public.admin_wait_restaurant_provisioning(uuid,uuid,uuid),public.admin_prepare_restaurant_invitation(uuid,uuid,uuid),public.admin_complete_restaurant_provisioning(uuid,uuid,uuid,uuid),public.admin_fail_restaurant_provisioning(uuid,uuid,uuid,text,boolean,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
