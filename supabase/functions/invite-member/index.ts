// invite-member — the only way an Atlas account gets created.
//
// Called by a signed-in officer from Settings. Never called with a bypass
// or a generated password: this issues a real Supabase invite email with a
// one-time link, and the member chooses their own password on /setup.
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
    .select("is_officer")
    .eq("email", callerEmail)
    .maybeSingle();
  if (callerRosterError || !callerRoster?.is_officer) {
    return json({ ok: false, reason: "not_an_officer" }, 403);
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

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    target.email,
    { redirectTo: REDIRECT_TO },
  );
  if (inviteError) {
    // Supabase returns a conflict if this email already has an auth user
    // (e.g. a previous invite that hasn't been used yet — resending is
    // fine and falls through to re-stamp invited_at below).
    if (!/already registered|already exists/i.test(inviteError.message)) {
      return json(
        { ok: false, reason: "invite_failed", detail: inviteError.message },
        500,
      );
    }
  }

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

  return json({ ok: true, email: target.email });
});
