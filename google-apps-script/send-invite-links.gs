/**
 * Atlas Service — bulk invite-link sender
 *
 * Pairs with Settings -> "Download All Invite Links" in the app, which
 * downloads a CSV (Name, Email, Invite Link) of everyone still "Not
 * invited". Paste that CSV into a Google Sheet, run this script, and it
 * emails each person their own link via your Gmail account — same
 * zero-cost approach as calendar-hold.gs, no SMTP, no per-person
 * copy/paste.
 *
 * Each link is one-time and gets spent the moment it's opened, so this
 * only ever emails it — it never opens or previews the links itself.
 *
 * SETUP (one time)
 * 1. Open the downloaded CSV, select all, copy.
 * 2. Make a new Google Sheet. Paste into cell A1 (Google Sheets will
 *    split it into columns automatically). Row 1 should read:
 *    Name | Email | Invite Link
 * 3. Extensions -> Apps Script. Replace the default Code.gs contents
 *    with this whole file. Save.
 * 4. Reload the Google Sheet tab. A new "Atlas" menu appears at the top
 *    (next to Help) after a few seconds — that's this script's
 *    onOpen() picking up. If you don't see it, run onOpen once manually
 *    from the Apps Script editor (Run -> onOpen) and re-approve access.
 * 5. In the Sheet, click Atlas -> Send Invite Links.
 *
 * Re-running is safe: any row already marked "Sent" in column D is
 * skipped, so you can add more rows later (another CSV export) and
 * re-run without double-emailing anyone.
 */

const SUBJECT = 'Set up your Atlas Service account';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Atlas')
    .addItem('Send Invite Links', 'sendInvites')
    .addToUi();
}

function sendInvites() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rows = sheet.getDataRange().getValues();
  const ui = SpreadsheetApp.getUi();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // Row 0 is the header (Name, Email, Invite Link[, Sent]) — start at 1.
  for (let i = 1; i < rows.length; i++) {
    const [name, email, link, status] = rows[i];
    if (!email || !link) continue;
    if (String(status || '').trim().toLowerCase() === 'sent') {
      skipped++;
      continue;
    }

    try {
      MailApp.sendEmail({
        to: email,
        name: 'Atlas Service',
        subject: SUBJECT,
        htmlBody: buildEmailHtml(name, link),
        body:
          (name ? 'Hi ' + name + ',\n\n' : 'Hi,\n\n') +
          "You've been invited to Atlas Service. Set up your account here:\n" +
          link +
          '\n\nThis link works once — open it yourself to get started, and finish choosing your password in the same sitting.',
      });
      sheet.getRange(i + 1, 4).setValue('Sent');
      sent++;
    } catch (err) {
      sheet.getRange(i + 1, 4).setValue('Failed: ' + err.message);
      failed++;
    }
  }

  ui.alert(
    'Atlas invites',
    sent + ' sent, ' + skipped + ' already done, ' + failed + ' failed.',
    ui.ButtonSet.OK,
  );
}

function buildEmailHtml(name, link) {
  const greeting = name ? 'Hi ' + escapeHtml(name) + ',' : 'Hi,';
  return (
    '<div style="font-family: Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; ' +
    'border: 1px solid #d5d9e0; border-radius: 3px; overflow: hidden;">' +
    '<div style="background: #0f2340; padding: 18px 24px;">' +
    '<span style="color: #ffffff; font-size: 17px; font-weight: 700; letter-spacing: 0.03em;">Atlas ' +
    '<span style="font-weight: 400; color: #bfd0e8;">Service</span></span>' +
    '</div>' +
    '<div style="padding: 24px; color: #111418;">' +
    '<p style="margin: 0 0 16px; font-size: 14px; line-height: 1.55;">' + greeting + '</p>' +
    '<p style="margin: 0 0 20px; font-size: 14px; line-height: 1.55;">' +
    "You've been invited to Atlas Service — set up your account and choose your own password." +
    '</p>' +
    '<p style="margin: 0 0 20px;"><a href="' + link + '" style="display: inline-block; ' +
    'background: #0f2340; color: #ffffff; padding: 11px 22px; border-radius: 2px; ' +
    'text-decoration: none; font-size: 13px; font-weight: 500; letter-spacing: 0.09em;">' +
    'SET UP MY ACCOUNT</a></p>' +
    '<p style="margin: 0; font-size: 12px; color: #5b6676;">This link works once — open it ' +
    'yourself and finish choosing your password in the same sitting.</p>' +
    '</div>' +
    '</div>'
  );
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
