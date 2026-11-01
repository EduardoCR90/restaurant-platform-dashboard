-- Phase 5: additive metadata + intentional restriction of module activation.
-- No CMS, Auth, integration or existing module values are changed.
begin;
revoke update(enabled) on public.restaurant_modules from authenticated;
alter policy tenant_module_activation on public.restaurant_modules using (false) with check (false);
create table public.template_releases (
 template_key text not null check(template_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 version text not null check(version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 source_commit text not null check(source_commit ~ '^[a-f0-9]{40}$'),
 distribution_hash text not null check(distribution_hash ~ '^[a-f0-9]{64}$'),
 configuration_contract integer not null check(configuration_contract=1),
 content_contract text not null check(content_contract='salitre-v1'),
 visual_contract integer not null check(visual_contract=2),
 primary key(template_key,version)
);
create unique index deployments_restaurant_identity on public.website_deployments(id,restaurant_id);
create table public.restaurant_websites (
 restaurant_id uuid primary key references public.restaurants(id),
 deployment_id uuid unique,
 installed_template_key text, installed_version text,
 desired_template_key text, desired_version text,
 revision integer not null default 0 check(revision>=0),
 verified_run_id text check(verified_run_id ~ '^[1-9][0-9]*$'),
 verified_run_attempt integer check(verified_run_attempt>0),
 verified_at timestamptz,
 custom_domain text check(custom_domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$'),
 custom_domain_status text not null default 'unverified' check(custom_domain_status in ('unverified','verified')),
 check((installed_template_key is null)=(installed_version is null)),
 check((desired_template_key is null)=(desired_version is null)),
 foreign key(deployment_id,restaurant_id) references public.website_deployments(id,restaurant_id),
 foreign key(installed_template_key,installed_version) references public.template_releases(template_key,version),
 foreign key(desired_template_key,desired_version) references public.template_releases(template_key,version)
);
create table public.website_template_builds (
 deployment_id uuid not null,
 run_id text not null, run_attempt integer not null,
 template_key text not null, version text not null,
 primary key(deployment_id,run_id,run_attempt),
 foreign key(deployment_id,run_id,run_attempt) references public.website_deployment_runs(deployment_id,run_id,run_attempt),
 foreign key(template_key,version) references public.template_releases(template_key,version)
);
alter table public.template_releases enable row level security;
alter table public.restaurant_websites enable row level security;
alter table public.website_template_builds enable row level security;
revoke all on public.template_releases,public.restaurant_websites,public.website_template_builds from public,anon,authenticated;
grant select on public.template_releases,public.restaurant_websites to authenticated;
grant select,insert on public.template_releases to service_role;
grant all on public.restaurant_websites,public.website_template_builds to service_role;
create policy template_catalog_read on public.template_releases for select to authenticated using(app_private.active_user());
create policy website_versions_read on public.restaurant_websites for select to authenticated using(public.is_platform_admin() or app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']));
create function public.admin_website_configure(actor uuid, operation text, payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; w public.restaurant_websites; release public.template_releases; expected integer;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501'; end if;
 r=(payload->>'restaurant_id')::uuid;
 perform 1 from public.restaurants where id=r for update;
 if not found then raise exception 'Restaurant unavailable'; end if;
 if operation='module_activation' then
  if not exists(select 1 from public.restaurant_module_entitlements where restaurant_id=r and module_key=payload->>'module_key' and granted) then raise exception 'Module not granted'; end if;
  update public.restaurant_modules set enabled=(payload->>'enabled')::boolean where restaurant_id=r and module_key=payload->>'module_key';
  if not found then raise exception 'Module unavailable'; end if;
 elsif operation='select_template' then
  select * into release from public.template_releases where template_key=payload->>'template_key' and version=payload->>'version';
  if not found then raise exception 'Release not approved'; end if;
  select * into w from public.restaurant_websites where restaurant_id=r for update;
  expected=(payload->>'expected_revision')::integer;
  if found then
   if expected is null or w.revision<>expected then raise exception 'Website revision conflict' using errcode='40001'; end if;
   if w.installed_version is not null and (w.installed_template_key<>release.template_key or split_part(w.installed_version,'.',1)<>split_part(release.version,'.',1) or string_to_array(release.version,'.')::integer[] < string_to_array(w.installed_version,'.')::integer[]) then raise exception 'Incompatible release or downgrade'; end if;
   update public.restaurant_websites set desired_template_key=release.template_key,desired_version=release.version,revision=revision+1 where restaurant_id=r;
  else
   if expected is not null then raise exception 'Website revision conflict' using errcode='40001'; end if;
   insert into public.restaurant_websites(restaurant_id,desired_template_key,desired_version) values(r,release.template_key,release.version);
  end if;
 else raise exception 'Unsupported operation'; end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,r,operation);
 return r;
end;$$;
-- Only the signed, registered main workflow calls this through the Edge backend.
-- Preparing/selecting a release NEVER reports it as installed.
create function public.report_template_build(target uuid, run text, attempt integer, sha text, phase text, identity jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d public.website_deployments; recorded public.website_deployment_runs; release public.template_releases; candidate public.website_template_builds;
begin
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 if phase not in ('ready','succeeded') then raise exception 'Invalid template phase'; end if;
 select * into d from public.website_deployments where id=target and enabled;
 if not found then raise exception 'Deployment unavailable'; end if;
 select * into recorded from public.website_deployment_runs where deployment_id=target and run_id=run and run_attempt=attempt and head_sha=sha;
 if not found or recorded.state not in ('ready','succeeded','skipped') then raise exception 'No validated deployment report'; end if;
 select * into release from public.template_releases where template_key=identity->>'template_key' and version=identity->>'version';
 if not found or to_jsonb(release)<>identity then raise exception 'Unapproved template identity'; end if;
 select * into candidate from public.website_template_builds where deployment_id=target and run_id=run and run_attempt=attempt for update;
 if phase='ready' then
  if found and (candidate.template_key<>release.template_key or candidate.version<>release.version) then raise exception 'Template changed during build'; end if;
  insert into public.website_template_builds values(target,run,attempt,release.template_key,release.version) on conflict do nothing;
 else
  if not found or candidate.template_key<>release.template_key or candidate.version<>release.version or recorded.state<>'succeeded' then raise exception 'No matching successful template build'; end if;
  insert into public.restaurant_websites(restaurant_id,deployment_id,installed_template_key,installed_version,revision,verified_run_id,verified_run_attempt,verified_at)
   values(d.restaurant_id,d.id,release.template_key,release.version,1,run,attempt,now())
  on conflict(restaurant_id) do update set deployment_id=excluded.deployment_id,installed_template_key=excluded.installed_template_key,installed_version=excluded.installed_version,
   revision=public.restaurant_websites.revision+1,verified_run_id=run,verified_run_attempt=attempt,verified_at=now()
  where public.restaurant_websites.verified_run_id is null or public.restaurant_websites.verified_run_id::numeric<run::numeric or
   (public.restaurant_websites.verified_run_id=run and public.restaurant_websites.verified_run_attempt<attempt);
 end if;
end;$$;
revoke all on function public.admin_website_configure(uuid,text,jsonb),public.report_template_build(uuid,text,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_website_configure(uuid,text,jsonb),public.report_template_build(uuid,text,integer,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
