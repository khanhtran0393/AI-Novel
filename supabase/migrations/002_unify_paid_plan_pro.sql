-- Collapse historical VIP rows into the single paid tier: Pro.
update public.licenses set plan = 'pro' where plan = 'vip';

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'licenses'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%plan%';

  if constraint_name is not null then
    execute format('alter table public.licenses drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.licenses
  add constraint licenses_plan_check check (plan in ('trial', 'pro'));
