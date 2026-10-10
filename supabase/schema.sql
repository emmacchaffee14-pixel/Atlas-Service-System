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
  -- Google Apps Script Web App URL (google-apps-script/calendar-hold.gs)
  -- that turns a signup, a transportation request, or a new event into a
  -- calendar invite instead of an email through a paid provider. Blank =
  -- nothing sent (fails silently, not loudly — see notify_signup() and
  -- notify_new_event() below).
  calendar_webhook_url text,
  constraint settings_singleton check (id = 1)
);

-- Safe to re-run against an already-provisioned settings table. Renamed
-- from transportation_webhook_url once the same webhook started also
-- covering member signup invites and new-event holds, not just rides.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'transportation_webhook_url')
     and not exists (select 1 from information_schema.columns
             where table_name = 'settings' and column_name = 'calendar_webhook_url') then
    alter table settings rename column transportation_webhook_url to calendar_webhook_url;
  end if;
end $$;
alter table settings add column if not exists calendar_webhook_url text;

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
  website        text,                            -- the partner's own site, separate from GivePulse
  directions     text,                            -- long-form arrival/prep notes shown on the member Signup page
  active         boolean not null default true
);

-- Safe to re-run against an already-provisioned orgs table.
alter table orgs add column if not exists website text;
alter table orgs add column if not exists directions text;

create table if not exists events (
  id             text primary key,
  org_id         text not null references orgs(id) on delete restrict,
  event_date     date not null,
  start_time     time not null,
  end_time       time not null,
  capacity       int  not null default 0,            -- 0 = open to the whole cohort
  status         text not null default 'open',
  -- Overrides for a partner whose events don't all happen at the same
  -- place or under the same GivePulse shift — e.g. Campus Kitchen cooks
  -- out of a different church each time. Null means "use the org's".
  location       text,
  givepulse_link text,
  constraint events_capacity_sane check (capacity >= 0)
);

-- Safe to re-run against an already-provisioned events table.
alter table events add column if not exists location text;
alter table events add column if not exists givepulse_link text;

-- Archived events are finished events an officer has put away. Members stop
-- seeing them (Opportunities, Log Service, claiming); officers keep them in
-- the Events archive. Rows stay readable so a member's own history and the
-- book-drive cap math in My Standing keep working.
alter table events add column if not exists archived boolean not null default false;

-- Dropped the admin_reminder_48h_sent/24h_sent flags: they only existed to
-- dedupe the old Resend-based cron reminders, which are gone in favor of
-- an immediate calendar hold per event (see notify_new_event() below).
alter table events drop column if exists admin_reminder_48h_sent;
alter table events drop column if exists admin_reminder_24h_sent;

-- ── People ─────────────────────────────────────────────────────────
-- roster is the gate: an email must be here before anyone can sign in.
create table if not exists roster (
  email        text primary key,
  full_name    text not null,
  mentor_id    bigint references mentors(id) on delete set null,
  is_officer   boolean not null default false,
  is_admin     boolean not null default false,  -- elevated officer: Settings access
  invited_at   timestamptz,          -- set when the welcome email goes out
  activated_at timestamptz,          -- set when they choose their password
  constraint roster_admin_is_officer check (not is_admin or is_officer)
);

-- Safe to re-run against an already-provisioned roster table.
alter table roster add column if not exists is_admin boolean not null default false;
do $$ begin
  alter table roster add constraint roster_admin_is_officer check (not is_admin or is_officer);
exception when duplicate_object then null;
end $$;

-- profiles links a real auth user to their roster row.
create table if not exists profiles (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null unique references roster(email) on delete restrict
);

-- Only roster emails become profiles. Anyone else who authenticates
-- gets rejected here rather than silently creating an orphan account.
-- This is what stops a stray @uga.edu address from self-registering.
--
-- Does NOT stamp activated_at. This trigger fires on auth.users INSERT,
-- which happens the instant an invite link is generated or sent — long
-- before the person has actually opened it, let alone chosen a password.
-- Stamping activated_at here made the Accounts table show "Active" (and
-- swap Copy Invite Link for Send Password Reset) for people who had
-- never done anything but be invited. mark_activated() below is what
-- actually marks it, called from the client only after a real password
-- is set.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from roster where email = lower(new.email)) then
    raise exception 'That email is not on the Atlas roster.';
  end if;
  insert into profiles (id, email) values (new.id, lower(new.email))
    on conflict (id) do nothing;
  return new;
end $$;

-- Called from AccountSetup.jsx right after supabase.auth.updateUser()
-- succeeds — the one point that actually means "this person is active,"
-- as opposed to merely invited. security definer + me() so a brand-new
-- member (not yet an officer) can stamp their own row despite roster's
-- write policy otherwise requiring is_officer().
create or replace function mark_activated()
returns void language plpgsql security definer set search_path = public as $$
begin
  update roster set activated_at = coalesce(activated_at, now())
   where email = me();
end $$;

-- Officers read who has and has not set up an account yet. There is no
-- password column anywhere: Supabase Auth owns credentials, and nothing
-- in this schema can read or reconstruct one.
--
-- security_invoker MATTERS. Without it a view runs with its creator's
-- privileges and quietly bypasses every policy below — one unguarded view
-- undoes the whole table's RLS. With it, the view obeys the caller's
-- policies on roster.
-- drop + create, not `create or replace`: Postgres only allows appending
-- trailing columns to a view in place, and is_admin sits before status.
drop view if exists account_status;
create view account_status
  with (security_invoker = true) as
  select r.email, r.full_name, r.is_officer, r.is_admin,
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

-- Promoting or demoting officer/admin status is an admin-only action, not
-- merely an officer one — Settings (where this happens) is admin-gated.
-- Skipped when there is no auth.uid() (the SQL editor, running as
-- postgres) so bootstrapping the first officer/admin by hand still works.
create or replace function guard_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and (new.is_officer is distinct from old.is_officer
          or new.is_admin is distinct from old.is_admin)
     and not is_admin() then
    raise exception 'Only an admin can change officer or admin status.';
  end if;
  return new;
end $$;

drop trigger if exists on_roster_role_change on roster;
create trigger on_roster_role_change
  before update on roster
  for each row execute function guard_role_changes();

-- ── Activity ───────────────────────────────────────────────────────

create table if not exists signups (
  id             bigint generated always as identity primary key,
  event_id       text not null references events(id) on delete cascade,
  member_email   text not null references roster(email) on delete cascade,
  member_name    text,                          -- denormalized: see roster_read below
  mentor_id      bigint references mentors(id) on delete set null,
  transportation boolean not null default false,
  advocating     boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (event_id, member_email)               -- nobody claims two spots
);

-- Safe to re-run against an already-provisioned signups table.
alter table signups add column if not exists member_name text;
update signups s set member_name = r.full_name
  from roster r where r.email = s.member_email and s.member_name is null;

-- Dropped the reminder_48h_sent/24h_sent flags along with due_events() and
-- the old Resend cron job — a member now gets their calendar invite once,
-- immediately, at claim_slot() time, so there's nothing left to dedupe.
alter table signups drop column if exists reminder_48h_sent;
alter table signups drop column if exists reminder_24h_sent;

create table if not exists service_logs (
  id           bigint generated always as identity primary key,
  event_id     text not null references events(id) on delete cascade,
  member_email text not null references roster(email) on delete cascade,
  hours        numeric not null check (hours > 0 and hours <= 12),
  quantity     numeric check (quantity >= 0),
  proof_path   text,                    -- storage.objects key in service-proofs, not a URL
  takeaway     text,
  created_at   timestamptz not null default now()
);

-- Safe to re-run: renames the old prototype-era URL column exactly once.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'service_logs' and column_name = 'proof_url')
     and not exists (select 1 from information_schema.columns
             where table_name = 'service_logs' and column_name = 'proof_path') then
    alter table service_logs rename column proof_url to proof_path;
  end if;
end $$;

-- A log is 'pending' until an officer approves it; only approved logs
-- count toward hours, impact and standing. Rows that already existed when
-- this was added are grandfathered in as approved. Members can only insert
-- pending rows (see logs_insert), and have no update policy, so they can't
-- approve their own. Defined here, above the policies that reference it.
alter table service_logs add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'declined'));
alter table service_logs alter column status set default 'pending';

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

-- Outreach contacts: officers' running list of who they've reached out to
-- while building partnerships — separate from `orgs` (confirmed partners
-- with events) and from `nominations.contact` (a one-off free-text field a
-- member types when nominating an org, never persisted anywhere reusable).
-- org_id is nullable: most contacts start as a lead before any partnership
-- exists, and get linked once one does.
create table if not exists contacts (
  id           bigint generated always as identity primary key,
  org_id       text references orgs(id) on delete set null,
  org_name     text,                 -- free text when there's no org_id yet
  name         text not null,
  email        text,
  phone        text,
  title        text,                 -- their role at the organization
  status       text not null default 'reached_out'
                 check (status in ('reached_out','responded','meeting_set','partner','declined','no_response')),
  notes        text,
  last_contact_date date,
  created_by   text references roster(email) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists signups_event_idx      on signups(event_id);
create index if not exists logs_member_idx        on service_logs(member_email);
create index if not exists logs_event_idx         on service_logs(event_id);
create index if not exists logs_status_idx        on service_logs(status);
create index if not exists nominations_status_idx on nominations(status);
create index if not exists contacts_org_idx       on contacts(org_id);
create index if not exists contacts_status_idx    on contacts(status);

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

-- Admin is the tier above officer: Settings (requirement rules, inviting
-- members, promoting officers and admins) is admin-only. Every admin is
-- also an officer (see roster_admin_is_officer above).
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_admin from roster r
                   join profiles p on p.email = r.email
                   where p.id = auth.uid()), false)
$$;

-- due_events() supported the old Resend-based send-event-reminders cron
-- job (find events sitting near the 48h/24h mark). That job is gone —
-- calendar invites go out immediately off the signups/events inserts
-- instead (see notify_signup() and notify_new_event() below) — so this
-- is dropped rather than left as unused surface area.
drop function if exists due_events(int, int);

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
  v_name     text;
  v_capacity int;
  v_taken    int;
begin
  if v_email is null then
    return json_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select capacity into v_capacity from events
   where id = p_event_id and not archived and is_public for update;
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

  -- A member can only read their OWN roster row (see roster_read below), so
  -- the "who else is going" list on Opportunities can't join against roster
  -- for other people's names. Stamping member_name here, once, at claim
  -- time — as security definer, bypassing that restriction — is what makes
  -- signups the source of names instead.
  select full_name into v_name from roster where email = v_email;

  insert into signups (event_id, member_email, member_name, mentor_id,
                       transportation, advocating, notes)
  values (p_event_id, v_email, v_name, p_mentor_id,
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
alter table contacts     enable row level security;

-- Everyone signed in reads the reference data; only officers change it.
do $$
declare t text;
begin
  foreach t in array array['mentors','orgs','events'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all to authenticated
                      using (is_officer()) with check (is_officer())', t, t);
  end loop;
end $$;

-- Settings lives on the Settings page, which is admin-only — the
-- requirement rules are more sensitive than a mentor roster edit.
drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated using (true);
drop policy if exists settings_write on settings;
create policy settings_write on settings for all to authenticated
  using (is_admin()) with check (is_admin());

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
  with check (member_email = me() and status = 'pending');
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

-- Contacts are an officer working list — not cohort-readable like signups,
-- and not member-writable like nominations.
drop policy if exists contacts_officer on contacts;
create policy contacts_officer on contacts for all to authenticated
  using (is_officer()) with check (is_officer());

-- ── Storage: service log proof photos ───────────────────────────────
-- Private bucket — no public URLs. A member's file lives under a path
-- prefixed with their own email (service-proofs/<email>/<...>), and
-- storage.foldername(name)[1] is that prefix. Members can only reach
-- their own folder; officers can read every folder, matching CLAUDE.md's
-- "private bucket, officers-read." Viewing requires a signed URL —
-- nothing here is servable by a bare object URL.
insert into storage.buckets (id, name, public)
values ('service-proofs', 'service-proofs', false)
on conflict (id) do nothing;

drop policy if exists service_proofs_insert on storage.objects;
create policy service_proofs_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'service-proofs'
    and (storage.foldername(name))[1] = public.me()
  );

drop policy if exists service_proofs_read on storage.objects;
create policy service_proofs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'service-proofs'
    and ((storage.foldername(name))[1] = public.me() or public.is_officer())
  );

drop policy if exists service_proofs_delete on storage.objects;
create policy service_proofs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'service-proofs'
    and (storage.foldername(name))[1] = public.me()
  );

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

-- ── Calendar holds instead of email ──────────────────────────────────
-- There used to be a pg_cron job here waking a Resend-backed Edge
-- Function every 30 minutes to email 48h/24h reminders. That's gone —
-- no paid email provider anywhere in this schema now. Everything below
-- fires immediately off the insert that caused it and posts straight to
-- a Google Apps Script Web App (google-apps-script/calendar-hold.gs),
-- which emails a calendar invite (.ics) to whoever should see it.
-- Outlook and Google Calendar both read a METHOD:REQUEST .ics as a real
-- meeting request with an Accept button.
--
-- pg_net is what lets a plpgsql trigger make that HTTP call. Wrapped in
-- its own DO/exception block so a plan without pg_net available doesn't
-- roll back anything created above it.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net unavailable (%) — calendar holds will silently no-op until it is enabled.', sqlerrm;
end $$;

-- Turns off the old cron job on an already-provisioned database that ran
-- this schema before the Resend-based reminders were removed. A no-op
-- (and harmless) if pg_cron was never enabled or the job never existed.
do $$ begin
  perform cron.unschedule('send-event-reminders');
exception when others then null;
end $$;

-- Fires on every claim (claim_slot() is the only thing that inserts into
-- signups) — the member always gets their own invite, and the admin
-- inbox additionally gets a "ride needed" invite when transportation is
-- checked. Wrapped so a blank webhook, a missing pg_net, or a down
-- script only loses a notification — it never fails the member's claim.
create or replace function notify_signup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_webhook  text;
  v_org_name text;
  v_location text;
  v_event    events%rowtype;
  v_when     text;
begin
  select calendar_webhook_url into v_webhook from settings where id = 1;
  if v_webhook is null or v_webhook = '' then
    return new;
  end if;

  select * into v_event from events where id = new.event_id;
  select name, location into v_org_name, v_location from orgs where id = v_event.org_id;
  v_org_name := coalesce(v_org_name, v_event.org_id);
  v_when := to_char(v_event.event_date, 'FMDay, FMMonth FMDD');

  begin
    perform net.http_post(
      url := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'to', new.member_email,
        'summary', v_org_name || ' — ' || v_when,
        'description', 'You''re signed up for ' || v_org_name || ' on ' || v_when
          || '. Can''t make it? Give up your spot from the Opportunities page so someone '
          || 'else can take it — not within 48 hours of the event, though; text the '
          || 'service chair instead.',
        'location', v_location,
        'event_date', v_event.event_date,
        'start_time', v_event.start_time,
        'end_time', v_event.end_time
      )
    );
  exception when others then
    raise log 'notify_signup: could not queue member invite (%)', sqlerrm;
  end;

  if new.transportation then
    begin
      perform net.http_post(
        url := v_webhook,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'summary', 'Ride needed: ' || coalesce(new.member_name, new.member_email) || ' — ' || v_org_name,
          'description', coalesce(new.member_name, new.member_email) || ' (' || new.member_email
            || ') needs transportation to ' || v_org_name || ' on ' || v_when
            || case when new.notes is not null then '. Notes: ' || new.notes else '' end,
          'location', v_location,
          'event_date', v_event.event_date,
          'start_time', v_event.start_time,
          'end_time', v_event.end_time
        )
      );
    exception when others then
      raise log 'notify_signup: could not queue transportation alert (%)', sqlerrm;
    end;
  end if;

  return new;
end $$;

drop trigger if exists on_signup_calendar_hold on signups;
create trigger on_signup_calendar_hold
  after insert on signups
  for each row execute function notify_signup();

-- Gives the admin a hold on their own calendar the moment an officer
-- adds an event — one per event, not one per signup.
create or replace function notify_new_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_webhook  text;
  v_org_name text;
  v_when     text;
begin
  select calendar_webhook_url into v_webhook from settings where id = 1;
  if v_webhook is null or v_webhook = '' then
    return new;
  end if;

  select name into v_org_name from orgs where id = new.org_id;
  v_org_name := coalesce(v_org_name, new.org_id);
  v_when := to_char(new.event_date, 'FMDay, FMMonth FMDD');

  begin
    perform net.http_post(
      url := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object(
        'summary', v_org_name || ' — ' || v_when,
        'description', v_org_name || ' on ' || v_when || case when new.capacity > 0
          then ' (' || new.capacity || ' spots).' else ' (open to the whole cohort).' end,
        'event_date', new.event_date,
        'start_time', new.start_time,
        'end_time', new.end_time
      )
    );
  exception when others then
    raise log 'notify_new_event: could not queue admin hold (%)', sqlerrm;
  end;

  return new;
end $$;

drop trigger if exists on_event_calendar_hold on events;
create trigger on_event_calendar_hold
  after insert on events
  for each row execute function notify_new_event();

-- ── Messages ───────────────────────────────────────────────────────
-- One-to-one correspondence between a member and the officers. One thread
-- per member: member_email is the thread, sender says which side wrote
-- each message. Members read and write only their own thread; officers
-- read and write all of them. Rows are deleted after 90 days (below).
create table if not exists messages (
  id           bigint generated always as identity primary key,
  member_email text not null references roster(email) on delete cascade,
  sender       text not null check (sender in ('member', 'officer')),
  sender_email text not null,
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at   timestamptz not null default now(),
  read_at      timestamptz                       -- set when the other side opens the thread
);
create index if not exists messages_thread_idx on messages(member_email, created_at);
create index if not exists messages_created_idx on messages(created_at);

alter table messages enable row level security;

drop policy if exists messages_read on messages;
create policy messages_read on messages for select to authenticated
  using (member_email = me() or is_officer());

-- Insert only — nobody edits or deletes a message. Marking read goes
-- through mark_thread_read() so no one can rewrite a message body.
drop policy if exists messages_member_send on messages;
create policy messages_member_send on messages for insert to authenticated
  with check (sender = 'member' and member_email = me() and sender_email = me());
drop policy if exists messages_officer_send on messages;
create policy messages_officer_send on messages for insert to authenticated
  with check (sender = 'officer' and is_officer() and sender_email = me());

create or replace function mark_thread_read(p_member_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if is_officer() then
    update messages set read_at = now()
     where member_email = lower(p_member_email) and sender = 'member' and read_at is null;
  elsif me() = lower(p_member_email) then
    update messages set read_at = now()
     where member_email = me() and sender = 'officer' and read_at is null;
  end if;
end $$;

-- Emails a "you have a new message" nudge through the same Apps Script
-- webhook as the calendar holds. The message text is never in the email —
-- the portal is the correspondence place. A member's message goes to the
-- script's ADMIN_EMAIL (no `to`); an officer's goes to the member's
-- signed-up email. Failures only lose the nudge, never the message.
create or replace function notify_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_webhook text;
  v_name    text;
begin
  select calendar_webhook_url into v_webhook from settings where id = 1;
  if v_webhook is null or v_webhook = '' then
    return new;
  end if;
  select full_name into v_name from roster where email = new.member_email;

  begin
    perform net.http_post(
      url := v_webhook,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := case when new.sender = 'officer' then
        jsonb_build_object(
          'kind', 'message',
          'to', new.member_email,
          'summary', 'New message from Atlas Service',
          'description', 'The Atlas service team sent you a message. Read it and reply in the portal.',
          'link', 'https://service.atlasuga.com/member/messages')
      else
        jsonb_build_object(
          'kind', 'message',
          'summary', 'New message from ' || coalesce(v_name, new.member_email),
          'description', coalesce(v_name, new.member_email) || ' sent a message in the service portal.',
          'link', 'https://service.atlasuga.com/admin/messages')
      end
    );
  exception when others then
    raise log 'notify_message: could not queue notification (%)', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists on_message_notify on messages;
create trigger on_message_notify
  after insert on messages
  for each row execute function notify_message();

-- 90-day retention, swept daily at 08:00 UTC. Needs the pg_cron extension
-- (Database → Extensions); if it isn't enabled this just skips scheduling.
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('purge-old-messages');
exception when others then null;
end $$;
do $$ begin
  perform cron.schedule('purge-old-messages', '0 8 * * *',
    $q$delete from messages where created_at < now() - interval '90 days'$q$);
exception when others then
  raise notice 'pg_cron unavailable — enable it and re-run to schedule the 90-day message purge.';
end $$;

-- ── Private events ─────────────────────────────────────────────────
-- A private event is invisible to the cohort. Officers assign members to it
-- (assign_members below); only those members see it, and it never appears
-- to anyone else. Making it public later is just flipping is_public.
alter table events add column if not exists is_public boolean not null default true;
alter table nominations add column if not exists event_id text references events(id) on delete set null;

-- Security-definer helpers so the events and signups policies can look at
-- each other without recursing through each other's RLS.
create or replace function event_is_public(p_event_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_public from events where id = p_event_id), false)
$$;

create or replace function has_signup(p_event_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from signups where event_id = p_event_id and member_email = me())
$$;

drop policy if exists events_read on events;
create policy events_read on events for select to authenticated
  using (is_public or is_officer() or has_signup(id));

-- Signups stay cohort-readable for public events ("who is going"); for a
-- private event only the assigned members (and officers) can see the list.
drop policy if exists signups_read on signups;
create policy signups_read on signups for select to authenticated
  using (member_email = me() or is_officer() or event_is_public(event_id) or has_signup(event_id));

-- Officers put members on an event without them claiming it. Goes through
-- here (not a signups insert policy) so it stays officer-only; the normal
-- signup trigger still sends each member their calendar invite.
create or replace function assign_members(p_event_id text, p_emails text[])
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  r       roster%rowtype;
begin
  if not is_officer() then
    raise exception 'officers only';
  end if;
  if not exists (select 1 from events where id = p_event_id) then
    raise exception 'no such event';
  end if;
  for r in
    select * from roster
     where email in (select lower(x) from unnest(p_emails) x)
  loop
    if not exists (select 1 from signups where event_id = p_event_id and member_email = r.email) then
      insert into signups (event_id, member_email, member_name, mentor_id, transportation, advocating)
      values (p_event_id, r.email, r.full_name, r.mentor_id, false, false);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;
revoke execute on function assign_members(text, text[]) from public, anon;
grant execute on function assign_members(text, text[]) to authenticated;


-- ── In-app notices ─────────────────────────────────────────────────
-- seen_at: when the member acknowledged an approve/decline decision on
-- their log (null = show it to them next login). Existing decisions are
-- marked seen so nobody gets a pile of old notices.
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'service_logs' and column_name = 'seen_at') then
    alter table service_logs add column seen_at timestamptz;
    update service_logs set seen_at = now() where status <> 'pending';
  end if;
end $$;

create or replace function mark_logs_seen()
returns void language sql security definer set search_path = public as $$
  update service_logs set seen_at = now()
   where member_email = me() and status <> 'pending' and seen_at is null
$$;
revoke execute on function mark_logs_seen() from public, anon;
grant execute on function mark_logs_seen() to authenticated;
