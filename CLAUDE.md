# Atlas Service Portal

A service sign-up and impact-tracking site for Atlas Business Society at UGA.
Replaces three Google Forms, a slot-grid spreadsheet, and a formula-driven
impact dashboard.

Two audiences, one site:

- **Members** browse events, claim a numbered slot, log hours afterward, and
  nominate outside organizations.
- **Officers** see the whole cohort — standing, mentor groups, events, impact
  numbers, and the nomination review queue.

Live at `service.atlasuga.com`. Supabase for data and auth, Vercel for hosting.

## Working prototype

`reference/portal-prototype.html` is a complete, working version of this app
backed by a different datastore. **Treat it as the specification.** Every
screen, label, calculation, and empty state is already resolved there. The port
changes the storage layer and authentication — not the interface.

Read it before writing anything.

## Business rules that are easy to get wrong

These came out of reconciling contradictory spreadsheets and forms. Do not
re-derive them.

1. **Three service hours per member per semester.** Stored in `settings`, not
   hardcoded — an officer can change it.

2. **The book-drive cap.** At most **one** hour from the ADOS / SWAB book
   donation event counts toward the requirement. A member who logs three ADOS
   hours has three *logged* hours and one *countable* hour. Show both. The
   requirement check uses countable hours.
   `countable = total_hours - max(0, ados_hours - swab_cap)`

3. **Reported vs. verified impact.** When six people at one event each answer
   "how many meals cooked" with the group total of 120, summing gives 720.
   - *Reported* = sum of all answers for the event. Shown for transparency.
   - *Verified* = **average** per event, rounded. Equals the true group number
     when everyone reports the same figure.
   - Partner rollups and the year-end headline numbers use **verified**.

4. **Capacity is per event, not per partner.** Campus Kitchen 5, ESP 10,
   Thomas Lay 5, UGArden 5. The ADOS book drive has `capacity = 0`, meaning
   open to the whole cohort — render "Open to every member", not slot pips.

5. **Claiming must be atomic.** Use the `claim_slot()` RPC, never a direct
   insert into `signups`. It locks the event row, re-counts, and refuses
   cleanly. Handle every `reason` it returns: `full`, `already_claimed`,
   `not_signed_in`, `no_such_event`.

6. **Members may not drop a slot within 48 hours of the event.** Currently a
   confirm dialog telling them to text the service chair instead. Worth making
   a real rule later.

7. **Say cohort, never chapter.**

8. **No bypass logins.** Every session comes from a real credential. The
   prototype briefly had an owner shortcut; it is gone and should stay gone.

## Data model

`supabase/schema.sql` is authoritative. Shape:

- `roster` — the gate. 65 UGA emails. **Nobody can sign in unless their email
  is already here**; a trigger on `auth.users` enforces it. `is_officer`
  controls admin access. `mentor_id` is null until assigned. `invited_at` and
  `activated_at` drive the accounts table in Settings.
- `profiles` — links an authenticated user to their roster row.
- `mentors` — 12 mentors. `group_name` is **null for all of them** and needs
  filling in through the Groups page.
- `orgs` / `events` — partners and the nine Fall 2026 events.
- `signups` / `service_logs` / `nominations` — member activity.
- `settings` — single row: hour requirement, book-drive cap, semester label.

Helpers: `me()` returns the signed-in member's email, `is_officer()` returns
their role. RLS uses both. Signups are readable by the whole cohort on
purpose — seeing who else is going is the point. Hours, nominations and the
roster are private to the member and officers.

**Security rules for anything you add:**

- Every new table in `public` needs `enable row level security` plus at least
  one policy. The `ensure_rls` event trigger enables RLS automatically, but it
  cannot write policies — a table with RLS and no policy returns nothing,
  which is the safe failure.
- Every new **view** needs `with (security_invoker = true)`. A view without it
  runs as its creator and silently bypasses the policies on the tables beneath
  it. This is the easiest way to undo all of the above by accident.
- Never reach for the service role key to "make a query work." It bypasses
  every policy here. It belongs only in the invite Edge Function.
- After any schema change, check Database → Security Advisor.

## Auth

**Email and password**, for members and officers alike. Same login surface,
two terminals on the landing page; `roster.is_officer` decides what they see
after sign-in. There is no "continue as officer" bypass — do not add one.

Onboarding is an **invite, not an assigned password**:

1. An officer issues invites from Settings. This calls Supabase
   `auth.admin.inviteUserByEmail()`, which must run server-side in an Edge
   Function — it needs the service role key, which never touches the browser.
2. The member gets a welcome email with a one-time link.
3. They land on the app and **choose their own password**.
4. `handle_new_user()` verifies their email is on the roster, creates the
   profile, and stamps `activated_at`.

**Never generate a password and email it.** It puts a working credential in
plaintext in 65 inboxes and trains people to reuse it. If an officer asks for
"just send them passwords," the answer is the invite flow — same outcome, and
nobody on the executive board can see anyone's password.

Password reset is Supabase's `resetPasswordForEmail`. An officer "resetting"
someone re-invites them; it does not set a password on their behalf.

Bootstrapping the first officer: insert your roster row and flip `is_officer`
by hand in the SQL editor, then invite yourself. Everyone after that comes
through Settings.

`account_status` is the view behind the Settings accounts table: name, email,
role, and Active / Invited / Not invited.

## Visual design

Taken from atlasuga.com — match it, since this sits under the same domain.

- **Colors: navy, white, grey, black only.** No accent color. Navy `#0F2340`
  carries every emphasis. Grey `#5B6676` for secondary text. There is
  deliberately no red — "Full" and warnings read in weight, not color.
- **Type:** Jost (geometric sans, Futura-like) for headings, nav, buttons and
  labels, with generous letter-spacing. Cormorant Garamond *italic* for
  taglines and page subheads — this is the face used for "The University of
  Georgia's Premier Business Society" and "Discover. Ignite. Lead."
- **Logo:** the Atlas globe. Reconstructed as inline SVG in the prototype from
  measurements of the real mark: outer ring 9% of diameter, inner lines ~5%,
  meridian ellipse `rx = 0.223D`, latitude lines at `±0.127D`, no equator.
  If you can get the original PNG off the Squarespace media library, use it.
- **Title Case** for page headings, nav items, and table headers. The wordmark
  reads "Atlas Service" — **not** all caps, despite the main site's hero.
- **Form fields must bottom-align across a row.** Labels vary in height
  because some carry sub-text; without `align-items: end` plus a fixed input
  height the boxes sit crooked. Native selects render shorter than text
  inputs, so set both explicitly.
- Labels do not wrap mid-phrase above 660px; below that the grid drops to one
  column rather than squeezing.

## Known gaps

- **Mentor groups are unnamed and unassigned.** Group reporting stays empty
  until an officer fills them in. The Groups page exists for this.
- **ESP has no GivePulse code** — shows as TBD, flagged on the dashboard.
- **Photo upload for service logs** is a URL field in the prototype because
  its datastore could not accept uploads. Supabase Storage can. Make it a real
  upload, private bucket, officers-read.

## Deploying

Supabase SQL editor: run `supabase/schema.sql`, then `supabase/seed.sql`.
Both are safe to re-run. Vercel project, env vars `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` — the same names as `.env.example`, since this
is a Vite app and not Next.js. Add `service.atlasuga.com` as a custom domain,
then a CNAME in Squarespace DNS.

**API keys.** Supabase replaced `anon` / `service_role` with **publishable**
(`sb_publishable_...`) and **secret** (`sb_secret_...`). Use the publishable
key in the browser; it is safe there only because RLS is on with policies
everywhere. The secret key bypasses all of it and belongs in exactly one
place: the invite Edge Function's secrets. Never in `.env.local`, never in
git, never in client code.
