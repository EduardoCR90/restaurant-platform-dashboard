-- Revisión requerida antes de aplicar. No contiene usuarios ni credenciales.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '' check (length(display_name)<=120),
 status text not null default 'active' check(status in ('active','suspended')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table app_private.platform_administrators (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now()
);
alter table app_private.platform_administrators enable row level security;
create table public.restaurants (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 120),
 slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 status text not null default 'pending' check(status in ('pending','active','suspended')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.restaurant_memberships (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 user_id uuid not null references public.profiles(id),
 role text not null check(role in ('restaurant_owner','restaurant_manager','restaurant_staff')),
 status text not null default 'active' check(status in ('invited','active','suspended')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(restaurant_id,user_id)
);
create index memberships_by_user on public.restaurant_memberships(user_id,restaurant_id);
create table public.restaurant_module_entitlements (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 module_key text not null check(module_key in ('content_management','reservations','staff_scheduling','qr_menu','events','analytics')),
 granted boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(restaurant_id,module_key)
);
create table public.restaurant_modules (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 module_key text not null check(module_key in ('content_management','reservations','staff_scheduling','qr_menu','events','analytics')),
 enabled boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(restaurant_id,module_key)
);
create table public.restaurant_integrations (
 id uuid primary key default gen_random_uuid(),restaurant_id uuid not null references public.restaurants(id),
 provider text not null check(provider='sanity'),external_project_id text not null check(external_project_id ~ '^[a-z0-9]{1,32}$'),
 external_dataset text not null check(external_dataset ~ '^[a-z0-9_-]{1,64}$'),
 configuration jsonb not null default '{"schema":"salitre-v1"}'::jsonb check(configuration='{"schema":"salitre-v1"}'::jsonb),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(restaurant_id,provider), unique(provider,external_project_id,external_dataset)
);
create table public.restaurant_invitations (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id),
 email text not null check(length(email)<=254),role text not null check(role in ('restaurant_owner','restaurant_manager','restaurant_staff')),
 invited_by uuid not null references public.profiles(id),user_id uuid references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','sent','failed')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table app_private.audit_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null, restaurant_id uuid,
 action text not null,created_at timestamptz not null default now()
);
alter table app_private.audit_events enable row level security;
create function app_private.touch_updated_at() returns trigger language plpgsql set search_path='' as $$
begin new.updated_at=now();return new;end;$$;
do $$ declare t text; begin
 foreach t in array array['profiles','restaurants','restaurant_memberships','restaurant_module_entitlements','restaurant_modules','restaurant_integrations','restaurant_invitations'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create trigger touch_updated_at before update on public.%I for each row execute function app_private.touch_updated_at()',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end;$$;
create function app_private.create_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id);return new;end;$$;
create trigger platform_create_profile after insert on auth.users for each row execute function app_private.create_profile();
create function app_private.active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=(select auth.uid()) and status='active');$$;
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$
 select app_private.active_user() and exists(select 1 from app_private.platform_administrators where user_id=(select auth.uid()));$$;
create function app_private.has_role(r uuid, roles text[] default array['restaurant_owner','restaurant_manager','restaurant_staff']) returns boolean language sql stable security definer set search_path='' as $$
 select app_private.active_user() and exists(select 1 from public.restaurants where id=r and status='active') and
 (public.is_platform_admin() or exists(select 1 from public.restaurant_memberships where restaurant_id=r and user_id=(select auth.uid()) and status='active' and role=any(roles)));$$;
create function app_private.entitled(r uuid, m text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.restaurant_module_entitlements where restaurant_id=r and module_key=m and granted);$$;
create policy own_profile on public.profiles for select to authenticated using(id=(select auth.uid()) and app_private.active_user());
create policy edit_display_name on public.profiles for update to authenticated using(id=(select auth.uid()) and app_private.active_user()) with check(id=(select auth.uid()) and status='active');
create policy tenant_restaurants on public.restaurants for select to authenticated using(app_private.has_role(id) or public.is_platform_admin());
create policy tenant_restaurant_name on public.restaurants for update to authenticated using(app_private.has_role(id,array['restaurant_owner','restaurant_manager'])) with check(app_private.has_role(id,array['restaurant_owner','restaurant_manager']));
create policy tenant_memberships on public.restaurant_memberships for select to authenticated using(public.is_platform_admin() or (app_private.has_role(restaurant_id) and (user_id=(select auth.uid()) or app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']))));
create policy tenant_entitlements on public.restaurant_module_entitlements for select to authenticated using(app_private.has_role(restaurant_id) or public.is_platform_admin());
create policy tenant_modules on public.restaurant_modules for select to authenticated using(app_private.has_role(restaurant_id) or public.is_platform_admin());
create policy tenant_module_activation on public.restaurant_modules for update to authenticated using(app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']) and app_private.entitled(restaurant_id,module_key)) with check(app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']) and app_private.entitled(restaurant_id,module_key));
create policy tenant_integrations on public.restaurant_integrations for select to authenticated using(app_private.has_role(restaurant_id,array['restaurant_owner','restaurant_manager']) or public.is_platform_admin());
create policy admin_invitations on public.restaurant_invitations for select to authenticated using(public.is_platform_admin());
grant select on public.profiles,public.restaurants,public.restaurant_memberships,public.restaurant_module_entitlements,public.restaurant_modules,public.restaurant_integrations,public.restaurant_invitations to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant update(name) on public.restaurants to authenticated;
grant update(enabled) on public.restaurant_modules to authenticated;
-- La RPC se ejecuta con el JWT del usuario, no con service_role.
create function public.authorize_content(restaurant uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not app_private.has_role(restaurant,array['restaurant_owner','restaurant_manager']) then raise exception 'Forbidden' using errcode='42501';end if;
 if not app_private.entitled(restaurant,'content_management') or not exists(select 1 from public.restaurant_modules where restaurant_id=restaurant and module_key='content_management' and enabled) then raise exception 'Module unavailable' using errcode='42501';end if;
 select jsonb_build_object('id',id,'projectId',external_project_id,'dataset',external_dataset,'schema',configuration->>'schema') into result from public.restaurant_integrations where restaurant_id=restaurant and provider='sanity';
 if result is null then raise exception 'Integration not configured';end if;
 return result;
end;$$;
-- Solo backend privilegiado. Además valida explícitamente el actor global activo.
create function public.admin_configure(actor uuid, operation text, payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid; target uuid;
begin
 if not exists(select 1 from app_private.platform_administrators a join public.profiles p on p.id=a.user_id where a.user_id=actor and p.status='active') then raise exception 'Forbidden' using errcode='42501';end if;
 if operation='restaurant' then
 insert into public.restaurants(name,slug,status) values(payload->>'name',payload->>'slug',payload->>'status') returning id into r;
 elsif operation='entitlement' then
 r=(payload->>'restaurant_id')::uuid;
 insert into public.restaurant_module_entitlements(restaurant_id,module_key,granted) values(r,payload->>'module_key',(payload->>'granted')::boolean) on conflict(restaurant_id,module_key) do update set granted=excluded.granted;
 insert into public.restaurant_modules(restaurant_id,module_key,enabled) values(r,payload->>'module_key',false) on conflict do nothing;
 elsif operation='membership' then
 r=(payload->>'restaurant_id')::uuid;target=(payload->>'user_id')::uuid;
 insert into public.restaurant_memberships(restaurant_id,user_id,role,status) values(r,target,payload->>'role',payload->>'status') on conflict(restaurant_id,user_id) do update set role=excluded.role,status=excluded.status;
 elsif operation='integration' then
 r=(payload->>'restaurant_id')::uuid;
 insert into public.restaurant_integrations(restaurant_id,provider,external_project_id,external_dataset) values(r,'sanity',payload->>'project_id',payload->>'dataset');
 elsif operation='restaurant_status' then
 r=(payload->>'restaurant_id')::uuid;update public.restaurants set status=payload->>'status' where id=r;
 elsif operation='user_status' then
 target=(payload->>'user_id')::uuid;update public.profiles set status=payload->>'status' where id=target;
 else raise exception 'Unsupported operation';end if;
 insert into app_private.audit_events(actor_id,restaurant_id,action) values(actor,r,operation);
 return coalesce(r,target);
end;$$;
revoke all on function public.admin_configure(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.admin_configure(uuid,text,jsonb) to service_role;
grant all on public.profiles,public.restaurants,public.restaurant_memberships,public.restaurant_modules,public.restaurant_module_entitlements,public.restaurant_integrations,public.restaurant_invitations to service_role;
revoke all on all functions in schema app_private from public,anon;
grant execute on function app_private.active_user(),app_private.has_role(uuid,text[]),app_private.entitled(uuid,text) to authenticated;
revoke all on function public.authorize_content(uuid),public.is_platform_admin() from public,anon;
grant execute on function public.authorize_content(uuid),public.is_platform_admin() to authenticated;
