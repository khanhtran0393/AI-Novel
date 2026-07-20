-- AI Novel commercial schema + RLS
-- Run in Supabase SQL Editor (or supabase db push)

-- Profiles (1-1 auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  hwid text not null,
  label text,
  last_seen_at timestamptz default now(),
  created_at timestamptz not null default now(),
  unique (user_id, hwid)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  plan text not null check (plan in ('month', 'year', 'lifetime')),
  amount_vnd int not null check (amount_vnd > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'rejected', 'refunded')),
  transfer_content text,
  hwid text,
  bill_path text,
  note text,
  guest_email text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_hwid_idx on public.orders (hwid);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  plan text not null check (plan in ('trial', 'pro')),
  hwid text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  exp_at timestamptz not null,
  token_hash text,
  activation_code text unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists licenses_hwid_idx on public.licenses (hwid, status);
create index if not exists licenses_user_idx on public.licenses (user_id);

create table if not exists public.audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Auto profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.orders enable row level security;
alter table public.licenses enable row level security;
alter table public.audit_logs enable row level security;

-- Drop old policies if re-run
do $$ begin
  -- profiles
  drop policy if exists "profiles_select_own" on public.profiles;
  drop policy if exists "profiles_update_own" on public.profiles;
  drop policy if exists "devices_all_own" on public.devices;
  drop policy if exists "orders_select_own" on public.orders;
  drop policy if exists "orders_insert_own" on public.orders;
  drop policy if exists "orders_admin_update" on public.orders;
  drop policy if exists "licenses_select_own" on public.licenses;
  drop policy if exists "audit_admin" on public.audit_logs;
end $$;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

create policy "devices_all_own" on public.devices
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create policy "orders_select_own" on public.orders
  for select using (user_id = auth.uid() or public.is_admin());

create policy "orders_insert_own" on public.orders
  for insert with check (user_id = auth.uid() or public.is_admin());

create policy "orders_admin_update" on public.orders
  for update using (public.is_admin());

-- licenses: users read own only; writes = service_role only (no insert policy for authenticated)
create policy "licenses_select_own" on public.licenses
  for select using (user_id = auth.uid() or public.is_admin());

create policy "audit_admin" on public.audit_logs
  for select using (public.is_admin());

-- After first signup as seller:
-- update public.profiles set role = 'admin' where email = 'you@example.com';
