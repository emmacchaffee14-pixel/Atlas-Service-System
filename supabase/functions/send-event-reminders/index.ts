// send-event-reminders — woken up every 30 minutes by a pg_cron job
// (see the bottom of supabase/schema.sql). Finds events sitting near the
// 48h and 24h mark via the due_events() SQL helper (which does the
// America/New_York-aware date math), emails everyone signed up plus the
// admin inbox, and stamps the *_sent flags so nobody gets double-emailed
// even if this fires more often than the window is wide.
import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// Resend's shared test sender works with no domain verification — swap
// in a verified atlasuga.com address once that's set up.
const FROM_EMAIL =
  Deno.env.get("REMINDER_FROM_EMAIL") ?? "Atlas Service <onboarding@resend.dev>";
const SITE_URL = Deno.env.get("APP_SITE_URL") ?? "https://service.atlasuga.com";
const ADMIN_EMAIL = "ecc44573@gmail.com";

type EventRow = {
  id: string;
  org_id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  admin_reminder_48h_sent: boolean;
  admin_reminder_24h_sent: boolean;
};

type SignupRow = {
  id: number;
  event_id: string;
  member_email: string;
  member_name: string | null;
  reminder_48h_sent: boolean;
  reminder_24h_sent: boolean;
};

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function whenLine(ev: EventRow): string {
  return `${formatDate(ev.event_date)}, ${formatTime(ev.start_time)}–${formatTime(ev.end_time)} ET`;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

function memberEmailHtml(orgName: string, ev: EventRow, offsetHours: number) {
  return `
    <p>Hi,</p>
    <p>You're signed up for <strong>${orgName}</strong> in about ${offsetHours} hours.</p>
    <p><strong>${whenLine(ev)}</strong></p>
    <p>Can't make it? Give up your spot from the Opportunities page so someone else can take it —
    not within 48 hours of the event, though; text the service chair instead.</p>
    <p><a href="${SITE_URL}/member/opportunities">Open Atlas Service</a></p>
  `;
}

function adminEmailHtml(orgName: string, ev: EventRow, offsetHours: number, signups: SignupRow[]) {
  const names = signups.length
    ? signups.map((s) => s.member_name || s.member_email).join(", ")
    : "nobody yet";
  return `
    <p><strong>${orgName}</strong> is in about ${offsetHours} hours.</p>
    <p><strong>${whenLine(ev)}</strong></p>
    <p>${signups.length} signed up: ${names}</p>
    <p><a href="${SITE_URL}/admin/events">Open Events</a></p>
  `;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = { emailsSent: 0, errors: [] as string[] };

  for (const offsetHours of [48, 24] as const) {
    const { data: dueEvents, error: dueError } = await admin.rpc("due_events", {
      p_offset_hours: offsetHours,
    });
    if (dueError) {
      summary.errors.push(`due_events(${offsetHours}): ${dueError.message}`);
      continue;
    }

    for (const ev of (dueEvents ?? []) as EventRow[]) {
      const { data: org } = await admin
        .from("orgs")
        .select("name")
        .eq("id", ev.org_id)
        .maybeSingle();
      const orgName = org?.name ?? ev.org_id;

      const { data: signups } = await admin
        .from("signups")
        .select("*")
        .eq("event_id", ev.id);
      const signupRows = (signups ?? []) as SignupRow[];

      const adminFlag = offsetHours === 48 ? "admin_reminder_48h_sent" : "admin_reminder_24h_sent";
      if (!ev[adminFlag]) {
        try {
          await sendEmail(
            ADMIN_EMAIL,
            `${orgName} in ${offsetHours}h — ${signupRows.length} signed up`,
            adminEmailHtml(orgName, ev, offsetHours, signupRows),
          );
          await admin.from("events").update({ [adminFlag]: true }).eq("id", ev.id);
          summary.emailsSent++;
        } catch (e) {
          summary.errors.push(`admin email for ${ev.id}: ${e}`);
        }
      }

      const memberFlag = offsetHours === 48 ? "reminder_48h_sent" : "reminder_24h_sent";
      for (const signup of signupRows) {
        if (signup[memberFlag]) continue;
        try {
          await sendEmail(
            signup.member_email,
            `Reminder: ${orgName} in ${offsetHours} hours`,
            memberEmailHtml(orgName, ev, offsetHours),
          );
          await admin.from("signups").update({ [memberFlag]: true }).eq("id", signup.id);
          summary.emailsSent++;
        } catch (e) {
          summary.errors.push(`member email for signup ${signup.id}: ${e}`);
        }
      }
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
