# Setup

## 1. Supabase

1. Create a project. Region: `us-east-1`.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. SQL Editor → paste `supabase/seed.sql` → Run.
   Then Settings → Data API for the Project URL, and Settings → API Keys for
   the **publishable** key. Both go in `.env.local`.
4. Make yourself an officer:
   ```sql
   update roster set is_officer = true where email = 'YOUR@uga.edu';
   ```
   (Add your own row first if you are not on the member roster.)
5. Authentication → Providers → **enable Email**, with "Confirm email" on.
   Set a minimum password length of 8.
6. Authentication → URL Configuration → Site URL `https://service.atlasuga.com`.
   While developing, also add `http://localhost:5173` to Redirect URLs or the
   invite links will bounce.
7. Deploy the `invite-member` Edge Function (`supabase/functions/invite-member`).
   It calls `auth.admin.inviteUserByEmail()` and stamps `roster.invited_at`.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically —
   nothing to set for those. The invite link's landing page defaults to
   `https://service.atlasuga.com/setup`; override it for local testing with a
   function secret:
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy invite-member
   supabase secrets set APP_URL=http://localhost:5173/setup   # optional, local only
   ```
   Officers call this function from Settings, passing their own session
   token as the `Authorization` bearer — the function checks `is_officer`
   itself before inviting anyone. It is the only way an account gets created.

## 2. Local

```bash
npm create vite@latest . -- --template react
npm install @supabase/supabase-js
cp .env.example .env.local     # fill in URL + anon key
claude
```

## 3. Vercel

Import the repo, add the two env vars, deploy.

## 4. Squarespace DNS

Settings → Domains → atlasuga.com → DNS Settings → add:

| Type  | Host      | Value                  |
|-------|-----------|------------------------|
| CNAME | `service` | `cname.vercel-dns.com` |

Then add `service.atlasuga.com` in Vercel → Domains. Propagation is usually
under an hour.

## Verify before launch

- An invited roster member sets their own password and lands on Opportunities.
- A non-roster email is **refused** — both at invite time and at sign-up.
- An uninvited roster member cannot self-register.
- A member signing in with an officer's page still gets the member view.
- Two browsers claiming the last slot: one wins, one sees "full".
- A member cannot read another member's hours (check the network tab, not the UI).
- Logging 3 ADOS hours shows 3 logged, 1 countable, requirement not met.
