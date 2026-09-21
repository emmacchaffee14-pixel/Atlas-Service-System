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
 *
 * After any edit to this file: Deploy -> Manage deployments -> pencil
 * icon -> Version: New version -> Deploy. Saving alone does not update
 * the live /exec URL — the deployed copy is frozen at whatever version
 * you last deployed.
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
    name: 'Atlas Service',
    subject: summary,
    body: description,
    htmlBody: buildHtmlBody({
      summary: summary,
      description: description,
      location: location,
      eventDate: body.event_date,
      startTime: body.start_time,
      endTime: body.end_time,
    }),
    attachments: [Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=REQUEST', 'invite.ics')],
  });

  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

// Matches the site's navy/white/grey palette (Jost isn't a web-safe email
// font, so this falls back to a plain sans stack). `body` above stays a
// plain-text fallback for clients that strip HTML; this is what most
// people actually see.
function buildHtmlBody(opts) {
  var whenLine = formatDateLine(opts.eventDate);
  if (opts.startTime) {
    whenLine += ' · ' + formatTimeLine(opts.startTime) + '–' + formatTimeLine(opts.endTime) + ' ET';
  }
  var descriptionHtml = escapeHtml(opts.description).replace(/\n/g, '<br>');

  return (
    '<div style="font-family: Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; ' +
    'border: 1px solid #d5d9e0; border-radius: 3px; overflow: hidden;">' +
    '<div style="background: #0f2340; padding: 18px 24px;">' +
    '<span style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.03em;">Atlas ' +
    '<span style="font-weight: 400; color: #bfd0e8;">Service</span></span>' +
    '</div>' +
    '<div style="padding: 24px; color: #111418;">' +
    '<h1 style="margin: 0 0 8px; font-size: 19px; font-weight: 600; line-height: 1.3;">' +
    escapeHtml(opts.summary) +
    '</h1>' +
    (whenLine
      ? '<p style="margin: 0 0 16px; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; ' +
        'text-transform: uppercase; color: #5b6676;">' +
        escapeHtml(whenLine) +
        '</p>'
      : '') +
    (opts.location
      ? '<p style="margin: 0 0 16px; font-size: 14px; color: #5b6676;">' + escapeHtml(opts.location) + '</p>'
      : '') +
    (descriptionHtml
      ? '<p style="margin: 0; font-size: 14px; line-height: 1.55; color: #111418;">' + descriptionHtml + '</p>'
      : '') +
    '<p style="margin: 24px 0 0; padding-top: 16px; border-top: 1px solid #d5d9e0; font-size: 12px; ' +
    'color: #5b6676;">A calendar invite is attached — accept it to add this to your calendar.</p>' +
    '</div>' +
    '</div>'
  );
}

function formatDateLine(dateStr) {
  var parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return String(dateStr || '');
  var months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return months[Number(parts[1]) - 1] + ' ' + Number(parts[2]) + ', ' + parts[0];
}

function formatTimeLine(timeStr) {
  var parts = String(timeStr || '').split(':');
  if (parts.length < 2) return String(timeStr || '');
  var h = Number(parts[0]);
  var period = h < 12 ? 'AM' : 'PM';
  var h12 = h % 12 || 12;
  return h12 + ':' + parts[1] + ' ' + period;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
