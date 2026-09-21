/**
 * Atlas Service — calendar holds
 *
 * The whole notification system runs through this one script instead of
 * a paid email provider: Postgres (see supabase/schema.sql —
 * notify_signup() and notify_new_event()) posts event details here
 * whenever a member claims a slot or an officer adds an event, and this
 * script emails a calendar invite (.ics) to whoever should see it.
 * Outlook and Google Calendar both read a METHOD:REQUEST .ics as a real
 * meeting request with an Accept button — no Microsoft/Graph API access
 * needed, and it costs nothing: this runs on Google's free Apps Script +
 * Gmail quota, not Resend or any other paid sender.
 *
 * Three things call this, distinguished only by what's in the JSON body
 * (there's no "kind" field to branch on — the caller decides everything,
 * including who it goes to):
 *   1. A member claims a slot -> they get an invite for that event.
 *   2. That same claim has "needs transportation" checked -> the admin
 *      inbox also gets a "ride needed" invite.
 *   3. An officer adds a new event -> the admin inbox gets a hold for it.
 *
 * SETUP
 * 1. https://script.google.com/ -> New project. Replace the default
 *    Code.gs contents with this whole file.
 * 2. Project Settings (gear icon) -> Script Properties -> add
 *    ADMIN_EMAIL = the inbox that should receive admin-facing holds
 *    (ride-needed alerts, new-event holds). Member invites go to the
 *    member's own email instead, passed in on every request.
 * 3. Deploy -> New deployment -> type "Web app" -> Execute as: Me ->
 *    Who has access: Anyone. (It only ever sends one email per request;
 *    there's no data to leak if the URL gets out, but treat it as a
 *    secret the way you would any webhook.)
 * 4. Copy the resulting /exec URL into Atlas Service -> Settings ->
 *    "Calendar webhook".
 * 5. Test: claim a slot as a member and check that member's inbox for an
 *    invite; check "needs transportation" and check ADMIN_EMAIL too; add
 *    a new event as an officer and check ADMIN_EMAIL again.
 */

function doPost(e) {
  var adminEmail = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!adminEmail) {
    return ContentService.createTextOutput('ADMIN_EMAIL script property not set').setMimeType(
      ContentService.MimeType.TEXT,
    );
  }

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput('Bad JSON: ' + err).setMimeType(ContentService.MimeType.TEXT);
  }

  var to = body.to || adminEmail;
  var summary = body.summary || 'Atlas Service event';
  var description = body.description || '';
  var location = body.location || '';
  var dtStart = toIcsLocal(body.event_date, body.start_time);
  var dtEnd = toIcsLocal(body.event_date, body.end_time);

  var ics = buildIcs({
    uid: Utilities.getUuid() + '@atlasuga.com',
    summary: summary,
    description: description,
    location: location,
    dtStart: dtStart,
    dtEnd: dtEnd,
    organizerEmail: adminEmail,
    attendeeEmail: to,
  });

  MailApp.sendEmail({
    to: to,
    subject: summary,
    body: description,
    attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=REQUEST', 'invite.ics')],
  });

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// '2026-10-09' + '18:00:00' -> '20261009T180000' (floating local time —
// paired with TZID=America/New_York below, not UTC).
function toIcsLocal(dateStr, timeStr) {
  var d = String(dateStr || '').replace(/-/g, '');
  var t = String(timeStr || '00:00:00').replace(/:/g, '').slice(0, 6);
  return d + 'T' + t;
}

function icsTimestampNow() {
  return Utilities.formatDate(new Date(), 'Etc/UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function buildIcs(opts) {
  var lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Atlas Service//Calendar Hold//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + opts.uid,
    'DTSTAMP:' + icsTimestampNow(),
    'DTSTART;TZID=America/New_York:' + opts.dtStart,
    'DTEND;TZID=America/New_York:' + opts.dtEnd,
    'SUMMARY:' + escapeIcs(opts.summary),
    'DESCRIPTION:' + escapeIcs(opts.description),
    'LOCATION:' + escapeIcs(opts.location),
    'ORGANIZER:mailto:' + opts.organizerEmail,
    'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:' + opts.attendeeEmail,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function escapeIcs(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}
