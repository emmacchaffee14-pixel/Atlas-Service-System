// invite-member — the only way an Atlas account gets created.
//
// Called by a signed-in admin from Settings. Never called with a bypass
// or a generated password: this issues a real one-time Supabase invite
// link, and the member chooses their own password on /setup.
//
// This generates the link (admin.auth.admin.generateLink) rather than
// sending it (admin.auth.admin.inviteUserByEmail) — Supabase's built-in
// email sender is rate-limited to a handful of sends per hour with no
// custom SMTP configured, nowhere near enough for onboarding a whole
// roster. generateLink creates the same underlying account and one-time
// link without Supabase ever sending anything, so there's no rate limit
// to hit; the admin copies the link and delivers it themselves.
//
// The link we hand back is NOT generateLink's own action_link. That link
// points straight at Supabase's /auth/v1/verify endpoint, which consumes
// the one-time token on a plain GET — and link-preview / security-scanner
// bots (Outlook Safe Links, iMessage's rich-preview fetcher, etc.) issue
// exactly that GET automatically, before the real person ever taps
// anything, burning the token and leaving them staring at "this link has
// expired." Instead we hand back the token_hash and point the link at our
// own /setup page, which requires an actual click before calling
// supabase.auth.verifyOtp() — a bot that merely fetches the URL never
// triggers that click, so it can't consume the token.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically by
// the Edge Function runtime — nothing to set by hand for those. The service
// role key never reaches the browser; it exists only in this function.
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Where the invite email's link lands. Set as a function secret to override
// for local testing (e.g. http://localhost:5173/setup); defaults to prod.
const REDIRECT_TO =
  Deno.env.get("APP_URL") ?? "https://service.atlasuga.com/setup";

function keyOf(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, reason: "method_not_allowed" }, 405);
  }

  // Two clients:
  //  - `caller`, bound to the requester's own JWT, so auth.getUser() tells
  //    us who is actually calling — never trust a client-supplied email.
  //  - `admin`, the service-role client, used only for the roster check,
  //    the invite itself, and stamping invited_at.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return json({ ok: false, reason: "not_signed_in" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerData, error: callerError } = await admin.auth.getUser(
    jwt,
  );
  if (callerError || !callerData.user) {
    return json({ ok: false, reason: "not_signed_in" }, 401);
  }
  const callerEmail = keyOf(callerData.user.email);

  const { data: callerRoster, error: callerRosterError } = await admin
    .from("roster")
    .select("is_admin")
    .eq("email", callerEmail)
    .maybeSingle();
  if (callerRosterError || !callerRoster?.is_admin) {
    return json({ ok: false, reason: "not_an_admin" }, 403);
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, reason: "bad_request" }, 400);
  }
  const email = keyOf(body.email);
  if (!email) {
    return json({ ok: false, reason: "missing_email" }, 400);
  }

  const { data: target, error: targetError } = await admin
    .from("roster")
    .select("email, full_name, invited_at, activated_at")
    .eq("email", email)
    .maybeSingle();
  if (targetError || !target) {
    return json({ ok: false, reason: "not_on_roster" }, 404);
  }
  if (target.activated_at) {
    return json({ ok: false, reason: "already_active" }, 409);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin
    .generateLink({
      type: "invite",
      email: target.email,
      options: { redirectTo: REDIRECT_TO },
    });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return json(
      { ok: false, reason: "invite_failed", detail: linkError?.message ?? "no token returned" },
      500,
    );
  }
  const link = `${REDIRECT_TO}?token_hash=${encodeURIComponent(tokenHash)}&type=invite`;

  const { error: stampError } = await admin
    .from("roster")
    .update({ invited_at: new Date().toISOString() })
    .eq("email", target.email);
  if (stampError) {
    return json(
      { ok: false, reason: "invited_but_not_stamped", detail: stampError.message },
      500,
    );
  }

  return json({ ok: true, email: target.email, link });
});
