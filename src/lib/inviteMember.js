import { supabase } from './supabaseClient.js'

// Calls the invite-member Edge Function, which is the only way an account
// gets created — it issues a real Supabase invite email and stamps
// roster.invited_at. Never generates or emails a password.
export async function inviteMember(email) {
  const { data, error } = await supabase.functions.invoke('invite-member', {
    body: { email },
  })
  if (error) {
    let reason = error.message
    try {
      const body = await error.context.json()
      // `reason` is a short bucket name ("invite_failed", "not_an_admin", …)
      // — `detail`, when present, is the actual message Supabase Auth
      // returned (e.g. an email rate-limit error), which is what actually
      // explains the failure. Prefer it.
      reason = body?.detail || body?.reason || reason
    } catch {
      // ignore — fall back to error.message
    }
    throw new Error(reason)
  }
  return data
}
