-- ═══════════════════════════════════════════════════════════════════
-- Atlas Service Portal — schema, security policies and slot claiming
-- Run this once in the Supabase SQL editor, then run seed.sql.
-- ═══════════════════════════════════════════════════════════════════

-- ── Reference tables ───────────────────────────────────────────────

create table if not exists settings (
  id               int primary key default 1,
  hour_requirement numeric not null default 3,
  swab_cap         numeric not null default 1,   -- max ADOS hours that count
  semester         text    not null default 'Fall 2026',
  constraint settings_singleton check (id = 1)
);

create table if not exists mentors (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  group_name text                                -- null until an officer names it
);

create table if not exists orgs (
  id             text primary key,
  name           text not null,
  location       text,
  description    text,
  impact_metric  text,
  givepulse_code text,
  givepulse_link text,
  active         boolean not null default true
);

create table if not exists events (
  id         text primary key,
  org_id     text not null references orgs(id) on delete restrict,
  event_date date not null,
  start_time time not null,
  end_time   time not null,
  capacity   int  not null default 0,            -- 0 = open to the whole cohort
  status     text not null default 'open',
  constraint events_capacity_sane check (capacity >= 0)
);

-- ── People ─────────────────────────────────────────────────────────
-- roster is the gate: an email must be here before anyone can sign in.
create table if not exists roster (
  email        text primary key,
  full_name    text not null,
  mentor_id    bigint references mentors(id) on delete set null,
  is_officer   boolean not null default false,
  invited_at   timestamptz,          -- set when the welcome email goes out
  activated_at timestamptz           -- set when they choose their password
);

-- profiles links a real auth user to their roster row.
create table if not exists profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null unique references roster(email) on delete restrict
);

-- Only roster emails become profiles. Anyone else who authenticates
-- gets rejected here rather than silently creating an orphan account.
-- This is what stops a stray @uga.edu address from self-registering.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roster where email = lower(new.email)) then
    raise exception 'That email is not on the Atlas roster.';
  end if;
  insert into profiles (id, email) values (new.id, lower(new.email))
    on conflict (id) do nothing;
  update roster set activated_at = coalesce(activated_at, now())
   where email = lower(new.email);
  return new;
end $$;

-- Officers read who has and has not set up an account yet. There is no
-- password column anywhere: Supabase Auth owns credentials, and nothing
-- in this schema can read or reconstruct one.
--
-- security_invoker MATTERS. Without it a view runs with its creator's
-- privileges and quietly bypasses every policy below — one unguarded view
-- undoes the whole table's RLS. With it, the view obeys the caller's
-- policies on roster.
create or replace view account_status
  with (security_invoker = true) as
  select r.email, r.full_name, r.is_officer,
         case when r.activated_at is not null then 'Active'
              when r.invited_at   is not null then 'Invited'
              else 'Not invited' end as status,
         r.invited_at, r.activated_at
    from roster r;

revoke all on account_status from anon;
grant select on account_status to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Activity ───────────────────────────────────────────────────────

create table if not exists signups (
  id             bigint generated always as identity primary key,
  event_id       text not null references events(id) on delete cascade,
  member_email   text not null references roster(email) on delete cascade,
  mentor_id      bigint references mentors(id) on delete set null,
  transportation boolean not null default false,
  advocating     boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (event_id, member_email)               -- nobody claims two spots
);

create table if not exists service_logs (
  id           bigint generated always as identity primary key,
  event_id     text not null references events(id) on delete cascade,
  member_email text not null references roster(email) on delete cascade,
  hours        numeric not null check (hours > 0 and hours <= 12),
  quantity     numeric check (quantity >= 0),
  proof_url    text,
  takeaway     text,
  created_at   timestamptz not null default now()
);

create table if not exists nominations (
  id           bigint generated always as identity primary key,
  member_email text not null references roster(email) on delete cascade,
  org_name     text not null,
  website      text,
  address      text not null,
  event_date   date not null,
  event_time   time not null,
  volunteers   int,
  contact      text not null,
  description  text not null,
  notes        text,
  status       text not null default 'pending'
                 check (status in ('pending','approved','declined')),
  created_at   timestamptz not null default now()
);

create index if not exists signups_event_idx      on signups(event_id);
create index if not exists logs_member_idx        on service_logs(member_email);
create index if not exists logs_event_idx         on service_logs(event_id);
create index if not exists nominations_status_idx on nominations(status);

-- ── Helpers ────────────────────────────────────────────────────────

create or replace function me()
returns text language sql stable security definer set search_path = public as $$
  select email from profiles where id = auth.uid()
$$;

create or replace function is_officer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_officer from roster r
                   join profiles p on p.email = r.email
                   where p.id = auth.uid()), false)
$$;

-- ── Claiming a spot, atomically ────────────────────────────────────
-- This is the whole point of leaving spreadsheets behind. The row lock
-- means two people tapping the last slot at the same instant produce one
-- winner and one clear refusal, never a sixth name in five slots.
create or replace function claim_slot(
  p_event_id       text,
  p_mentor_id      bigint,
  p_transportation boolean default false,
  p_advocating     boolean default false,
  p_notes          text default null
) returns json language plpgsql security definer set search_path = public as $$
declare
  v_email    text := me();
  v_capacity int;
  v_taken    int;
begin
  if v_email is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select capacity into v_capacity from events where id = p_event_id for update;
  if not found then
    return json_build_object('ok', false, 'reason', 'no_such_event');
  end if;

  if exists (select 1 from signups
             where event_id = p_event_id and member_email = v_email) then
    return json_build_object('ok', false, 'reason', 'already_claimed');
  end if;

  if v_capacity > 0 then
    select count(*) into v_taken from signups where event_id = p_event_id;
    if v_taken >= v_capacity then
      return json_build_object('ok', false, 'reason', 'full');
    end if;
  end if;

  insert into signups (event_id, member_email, mentor_id,
                       transportation, advocating, notes)
  values (p_event_id, v_email, p_mentor_id,
          p_transportation, p_advocating, p_notes);

  -- First time a member names their mentor, remember it on the roster.
  update roster set mentor_id = p_mentor_id
   where email = v_email and mentor_id is null and p_mentor_id is not null;

  return json_build_object('ok', true);
end $$;

-- ── Row level security ─────────────────────────────────────────────

alter table settings     enable row level security;
alter table mentors      enable row level security;
alter table orgs         enable row level security;
alter table events       enable row level security;
alter table roster       enable row level security;
alter table profiles     enable row level security;
alter table signups      enable row level security;
alter table service_logs enable row level security;
alter table nominations  enable row level security;

-- Everyone signed in reads the reference data; only officers change it.
do $$
declare t text;
begin
  foreach t in array array['settings','mentors','orgs','events'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all to authenticated
                      using (is_officer()) with check (is_officer())', t, t);
  end loop;
end $$;

-- Roster holds all 65 UGA emails. A member needs their OWN row (name,
-- mentor, standing) and nothing else — names of people at an event come
-- from signups, not from here. Officers see everyone.
drop policy if exists roster_read on roster;
create policy roster_read on roster for select to authenticated
  using (email = me() or is_officer());
drop policy if exists roster_write on roster;
create policy roster_write on roster for all to authenticated
  using (is_officer()) with check (is_officer());

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles for select to authenticated
  using (id = auth.uid() or is_officer());

-- Signups are public to the cohort on purpose: seeing who else is going
-- is the feature. You may only create or drop your own.
drop policy if exists signups_read on signups;
create policy signups_read on signups for select to authenticated using (true);
drop policy if exists signups_delete on signups;
create policy signups_delete on signups for delete to authenticated
  using (member_email = me() or is_officer());
-- No insert policy: inserts go through claim_slot() so capacity is enforced.

-- Hours are private to the member and the officers.
drop policy if exists logs_read on service_logs;
create policy logs_read on service_logs for select to authenticated
  using (member_email = me() or is_officer());
drop policy if exists logs_insert on service_logs;
create policy logs_insert on service_logs for insert to authenticated
  with check (member_email = me());
drop policy if exists logs_admin on service_logs;
create policy logs_admin on service_logs for all to authenticated
  using (is_officer()) with check (is_officer());

drop policy if exists noms_read on nominations;
create policy noms_read on nominations for select to authenticated
  using (member_email = me() or is_officer());
drop policy if exists noms_insert on nominations;
create policy noms_insert on nominations for insert to authenticated
  with check (member_email = me());
drop policy if exists noms_review on nominations;
create policy noms_review on nominations for update to authenticated
  using (is_officer()) with check (is_officer());

-- ── Belt and braces: RLS on by default for future tables ───────────
-- Every table above already has RLS enabled explicitly. This trigger
-- covers the ones you have not written yet: a table created in `public`
-- without RLS is readable by anyone holding the anon key, which ships in
-- the browser bundle. Cheap insurance while an agent is adding tables.
create or replace function rls_auto_enable()
returns event_trigger language plpgsql security definer
set search_path = pg_catalog as $$
declare cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
             where command_tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
               and object_type in ('table','partitioned table') loop
    if cmd.schema_name = 'public' then
      begin
        execute format('alter table %s enable row level security', cmd.object_identity);
        raise log 'Auto-enabled RLS on %', cmd.object_identity;
      exception when others then
        raise log 'Could not enable RLS on %', cmd.object_identity;
      end;
    end if;
  end loop;
end $$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls on ddl_command_end
  when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO')
  execute function rls_auto_enable();

-- Enabling RLS with no policy denies everything. That is the safe failure:
-- a new table returns nothing until you write a policy, rather than
-- returning everything. Check Database → Security Advisor after any
-- schema change.
