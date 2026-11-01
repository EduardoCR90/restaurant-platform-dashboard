-- Aditiva: solo metadatos. No modifica contenido, usuarios, roles ni integraciones existentes.
begin;
create table public.website_deployments (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id),
 integration_id uuid not null unique references public.restaurant_integrations(id),
 project_id text not null, dataset text not null,
 repository text not null unique check(repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
 repository_id text not null unique check(repository_id ~ '^[1-9][0-9]+$'),
 site_url text not null check(site_url ~ '^https://'),
 enabled boolean not null default true,
 unique(id,restaurant_id,integration_id)
);
create table public.publication_operations (
 id uuid primary key,
 restaurant_id uuid not null references public.restaurants(id),
 integration_id uuid not null references public.restaurant_integrations(id),
 deployment_id uuid references public.website_deployments(id),
 actor_id uuid not null references public.profiles(id),
 document_id text not null check(length(document_id) between 1 and 200),
 action text not null check(action in ('publish','withdraw','restore')),
 previous_fingerprint text, fingerprint text,
 state text not null default 'publishing_sanity' check(state in ('publishing_sanity','awaiting_deployment','deploying','updated','sanity_error','deployment_error')),
 error_code text, created_at timestamptz not null default now(), accepted_at timestamptz, completed_at timestamptz,
 run_id text, run_attempt integer,
 foreign key(deployment_id,restaurant_id,integration_id) references public.website_deployments(id,restaurant_id,integration_id),
 check(fingerprint is null or fingerprint ~ '^[a-f0-9]{64}$'),
 check(previous_fingerprint is null or previous_fingerprint ~ '^[a-f0-9]{64}$')
);
create index publications_by_restaurant on public.publication_operations(restaurant_id,created_at desc);
create index publication_fingerprints on public.publication_operations(deployment_id,fingerprint);
create table public.website_deployment_runs (
 deployment_id uuid not null references public.website_deployments(id),
 run_id text not null check(run_id ~ '^[1-9][0-9]+$'), run_attempt integer not null check(run_attempt>0),
 head_sha text not null check(head_sha ~ '^[a-f0-9]{40}$'),
 state text not null check(state in ('building','ready','succeeded','failed','skipped')),
 fingerprints text[] not null default '{}',
 started_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(deployment_id,run_id,run_attempt), check(cardinality(fingerprints)<=10000)
);
alter table public.website_deployments enable row level security;
alter table public.publication_operations enable row level security;
alter table public.website_deployment_runs enable row level security;
revoke all on public.website_deployments,public.publication_operations,public.website_deployment_runs from public,anon,authenticated;
grant all on public.website_deployments,public.publication_operations,public.website_deployment_runs to service_role;
grant select on public.publication_operations to authenticated;
create policy editorial_publications on public.publication_operations for select to authenticated using (
 app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']) and
 app_private.entitled(restaurant_id,'content_management') and
 exists(select 1 from public.restaurant_modules where restaurant_id=publication_operations.restaurant_id and module_key='content_management' and enabled)
);
-- Una única reconciliación serializada por destino: callbacks repetidos y carreras son idempotentes.
create function public.reconcile_publications(target uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 with recursive coverage as (
  select p.id,p.document_id,p.previous_fingerprint,r.run_id,r.run_attempt,r.state,r.started_at
  from public.publication_operations p join public.website_deployment_runs r on r.deployment_id=p.deployment_id and p.fingerprint=any(r.fingerprints)
  where p.deployment_id=target and p.accepted_at is not null and r.state<>'skipped'
  union
  select p.id,p.document_id,p.previous_fingerprint,c.run_id,c.run_attempt,c.state,c.started_at
  from coverage c join public.publication_operations p on p.deployment_id=target and p.document_id=c.document_id and p.fingerprint=c.previous_fingerprint
  where p.accepted_at is not null
 ), chosen as (
  select distinct on(id) * from coverage order by id,(state='succeeded') desc,started_at desc,run_attempt desc
 )
 update public.publication_operations p set
 state=case c.state when 'succeeded' then 'updated' when 'failed' then 'deployment_error' else 'deploying' end,
 error_code=case when c.state='failed' then 'deployment_failed' else null end,
 run_id=c.run_id,run_attempt=c.run_attempt,
 completed_at=case when c.state='succeeded' then coalesce(p.completed_at,now()) else null end
 from chosen c where p.id=c.id and p.state<>'updated';
 update public.publication_operations set state='deployment_error',error_code=case when run_id is null then 'run_not_found' else 'deployment_expired' end
 where deployment_id=target and state in ('awaiting_deployment','deploying') and accepted_at<now()-interval '30 minutes';
 update public.publication_operations set state='sanity_error',error_code='sanity_confirmation_missing'
 where deployment_id=target and state='publishing_sanity' and created_at<now()-interval '2 minutes';
end;$$;
create function public.report_website_deployment(target uuid, run text, attempt integer, sha text, phase text, hashes text[]) returns boolean language plpgsql security definer set search_path='' as $$
declare current public.website_deployment_runs; previous public.website_deployment_runs;
begin
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 if phase not in ('building','ready','succeeded','failed','skipped') or cardinality(hashes)>10000 or exists(select 1 from unnest(hashes) h where h !~ '^[a-f0-9]{64}$') then raise exception 'Invalid report'; end if;
 if not exists(select 1 from public.website_deployments d join public.restaurant_integrations i on i.id=d.integration_id and i.restaurant_id=d.restaurant_id and i.external_project_id=d.project_id and i.external_dataset=d.dataset where d.id=target and d.enabled) then raise exception 'Deployment unavailable'; end if;
 select * into current from public.website_deployment_runs where deployment_id=target and run_id=run and run_attempt=attempt for update;
 if found then
  if current.head_sha<>sha then raise exception 'Run identity changed'; end if;
  if cardinality(current.fingerprints)>0 and cardinality(hashes)>0 and current.fingerprints<>hashes then raise exception 'Build evidence changed'; end if;
  if current.state in ('succeeded','failed','skipped') then
   if phase in ('succeeded','failed','skipped') and phase<>current.state then raise exception 'Conflicting terminal report'; end if;
  else
   update public.website_deployment_runs set state=case when current.state='ready' and phase='building' then 'ready' else phase end,
   fingerprints=case when cardinality(hashes)>0 then hashes else fingerprints end,updated_at=now()
   where deployment_id=target and run_id=run and run_attempt=attempt;
  end if;
 else
  insert into public.website_deployment_runs(deployment_id,run_id,run_attempt,head_sha,state,fingerprints) values(target,run,attempt,sha,phase,hashes);
 end if;
 if current.state='skipped' or (current.state='succeeded' and phase='ready') then return false; end if;
 if phase='ready' and cardinality(hashes)>0 and coalesce(current.state,'') not in ('succeeded','failed','skipped') then
  select * into previous from public.website_deployment_runs where deployment_id=target and state='succeeded' order by run_id::numeric desc,run_attempt desc limit 1;
  if found and previous.head_sha=sha and previous.fingerprints=hashes then
   update public.website_deployment_runs set state='skipped',updated_at=now() where deployment_id=target and run_id=run and run_attempt=attempt;
   perform public.reconcile_publications(target);
   return false;
  end if;
 end if;
 perform public.reconcile_publications(target);
 return true;
end;$$;
revoke all on function public.reconcile_publications(uuid),public.report_website_deployment(uuid,text,integer,text,text,text[]) from public,anon,authenticated;
grant execute on function public.reconcile_publications(uuid),public.report_website_deployment(uuid,text,integer,text,text,text[]) to service_role;
commit;
