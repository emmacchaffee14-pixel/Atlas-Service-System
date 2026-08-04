# Atlas Service Events System — Architecture & Technical Design

**Status:** Proposed (pre-implementation)
**Author:** Claude Code (acting as senior product architect)
**Audience:** Atlas Business Society officers, current and future Service Chairs
**Scope:** This document is a design specification only. No implementation code is included. It is the basis for Milestone 1 (data model + sheets) and subsequent implementation milestones.

---

## 0. Problem Statement (for context)

The current system has three disconnected artifacts — an editable Google Sheet, a logistics Google Form, and a post-event attendance Google Form — each acting as a partial "source of truth." Members inconsistently complete one, two, or all three, and officers manually reconcile them every semester. This redesign eliminates the reconciliation problem structurally, rather than through more manual process discipline.

---

## 1. Primary Design Principles (ranked, as given)

1. **One source of truth** — one member action reserves a spot; no duplicate entry.
2. **Minimal member effort** — signup under a minute; certainty of success.
3. **Minimal officer maintenance** — no manual copying; capacity, hours, and reports are automatic.
4. **Simple handoff** — a new Service Chair with no engineering background can learn it in under an hour.
5. **Scalable** — 500+ members, 100+ events, multiple concurrent semesters, multiple simultaneous officers.

Every design decision below is evaluated against this ordering. Where a choice trades scalability for simplicity, that trade is made deliberately and stated explicitly, because principles 1–4 outrank principle 5 at Atlas's actual size (a few hundred members, not tens of thousands).

---

## 2. High-Level Workflow

```
MEMBER                          SYSTEM (Apps Script + Sheets)              OFFICER
───────────────────────────────────────────────────────────────────────────────────
Discovers event            
(dashboard / group chat link)
        │
        ▼
Fills ONE Signup Form  ─────►  onFormSubmit trigger fires
(name/email auto-filled            │
 by UGA Google login,               ▼
 event, transport, driver,     Capacity check (LockService)
 notes)                             │
                              ┌──────┴──────┐
                              ▼             ▼
                        Spot available   Event full
                              │             │
                              ▼             ▼
                        Status=Confirmed  Status=Waitlisted
                              │             │
                              ▼             ▼
                        Confirmation      Waitlist email
                        email + QR code   (auto-promoted if
                        sent instantly     a spot opens)
                                                              ◄── Officer creates/edits
                                                                  event in Events tab
                                                                  (capacity, date, org)
                                                                  — no code, no form
        │
        ▼
Attends event
        │
        ▼
Checks in (QR scan by     ─────►  AttendanceService writes          Officer scans QR
officer, OR officer            Attendance row, links to             (or checks roster
roll-call checklist)           Signup + Event                       on phone/laptop)
        │                           │
        ▼                           ▼
Hours awarded automatically   ServiceHoursSummary (live QUERY
(Event.HoursValue)             over Attendance × Events)
                                     │
                                     ▼
                              Officer Dashboard updates live
                              (spots left, waitlist, transport
                               needs, attendance %, hours)
                                     │
                                     ▼
                              Semester Report generated
                              (one-click export, no manual
                               copy/paste) ──────────────► Officer distributes
                                                            to exec board / members
```

**Key structural fix:** there is exactly one member-facing input surface (the Signup Form) and exactly one attendance-recording surface (QR/roll-call). Everything downstream — capacity, hours, reports — is *computed*, never re-entered.

---

## 3. Data Model

All tables live as tabs inside **one Google Sheet** ("Atlas Service System"), not separate spreadsheets. Rationale is in §4. Each table below lists its columns, key, and role (Input = humans/forms write it, Computed = formulas/script derive it, Config = officers tune it).

### 3.1 `Organizations`
| Column | Type | Notes |
|---|---|---|
| OrgID | text (key) | e.g. `ORG-001`, script-assigned |
| Name | text | |
| ContactName | text | |
| ContactEmail | text | |
| ContactPhone | text | optional |
| Description | text | |
| MaxSimultaneousMembers | number | required ≥ 3 (validated) |
| Status | enum | Active / Pending / Archived |
| DateAdded | date | |
| AddedBy | text | officer email or "Advocate Workflow" |
| Notes | text | |

Role: Input (direct officer edits) + Input (via approved `OrgProposals`).

### 3.2 `Events`
| Column | Type | Notes |
|---|---|---|
| EventID | text (key) | script-assigned |
| OrgID | text (FK → Organizations) | dropdown, data-validated against Organizations |
| Title | text | |
| Semester | text | e.g. `Fall 2026`, defaults from `Settings.CurrentSemester` |
| Date / StartTime / EndTime | date/time | |
| Location | text | |
| Capacity | number | |
| WaitlistEnabled | boolean | |
| RegistrationOpensAt / ClosesAt | datetime | auto-close enforced by script |
| Status | enum | Draft / Open / Closed / Cancelled / Completed |
| HoursValue | number | service hours awarded per confirmed attendance |
| TemplateID | text (FK, nullable) | set if generated from `RecurringEventTemplates` |
| CreatedBy / CreatedAt | text/datetime | |

Role: Input (officer-authored, structured record).

### 3.3 `RecurringEventTemplates`
| Column | Type | Notes |
|---|---|---|
| TemplateID | text (key) | |
| OrgID | text (FK) | |
| Title, DefaultCapacity, DefaultHours, DefaultLocation | — | |
| RecurrenceRule | enum + interval | Weekly / Biweekly / Monthly |
| StartDate / EndDate | date | |
| Status | enum | Active / Paused |

Role: Input. A nightly trigger materializes upcoming `Events` rows from active templates (keeps a rolling horizon, e.g. always 4 weeks of occurrences published).

### 3.4 `Members`
| Column | Type | Notes |
|---|---|---|
| Email | text (key) | verified — see §4 |
| FullName | text | |
| Phone, ClassYear, Major | — | optional |
| DateJoined | date | |
| HoursRequiredThisSemester | number | defaults from `Settings` |
| Status | enum | Active / Inactive / Unverified |

Seeded once per semester by officer roster import; auto-grown when a new email signs up (flagged `Unverified` for a quick officer glance, not a blocker).

### 3.5 `Signups` (Form Responses, script-processed)
| Column | Type | Notes |
|---|---|---|
| SignupID | text (key) | |
| Timestamp | datetime | Form-populated |
| EventID | text (FK) | dynamic dropdown, populated by script |
| MemberEmail / MemberName | text | auto-filled from Google login |
| TransportationNeeded | boolean | |
| CanDrive | enum | No / Yes (# seats) |
| Notes | text | |
| Status | enum | Confirmed / Waitlisted / Cancelled |
| ConfirmationCode | text | script-generated, used as QR payload |
| ProcessedAt | datetime | |

Role: Input (raw Form response) → Computed (Status/Code written by script within seconds).

### 3.6 `Attendance`
| Column | Type | Notes |
|---|---|---|
| AttendanceID | text (key) | |
| EventID / MemberEmail | FK | |
| CheckInTimestamp | datetime | |
| CheckInMethod | enum | QR / OfficerRollCall |
| CheckedInBy | text | officer email |
| HoursAwarded | number | copied from `Events.HoursValue` at check-in time (so later edits to an event don't retroactively rewrite history) |

Role: Computed, script-written only (no manual free-typing into this tab — see protected-range guidance in §6 risks).

### 3.7 `ServiceHoursSummary` (view, not a stored table)
A `QUERY`/`SUMIFS` view joining `Attendance` → `Events.HoursValue`, grouped by `Member × Semester`, producing: Hours Completed, Events Attended, Remaining Hours (vs `Members.HoursRequiredThisSemester`). Kept as a **live formula view**, not a script-written table, so it can never drift out of sync with `Attendance` (principle #1). Materialize to a script-written cache only if/when row counts make `QUERY` noticeably slow (see §7 Scalability).

### 3.8 `OrgProposals` (Advocate-an-Org workflow)
| Column | Type | Notes |
|---|---|---|
| ProposalID | text (key) | |
| SubmittedBy / SubmittedAt | text/datetime | |
| OrgName, ContactInfo, Description | text | |
| CapacityConfirmed | boolean | "can host ≥ 3 Atlas members simultaneously" checkbox |
| Status | enum | Pending / Approved / Rejected |
| ReviewedBy / ReviewNotes / ReviewedAt | — | |

On officer approval (menu action), script copies the row into `Organizations` with `Status=Active`; nothing is ever auto-published without review.

### 3.9 `Settings`
Key/value config tab: `CurrentSemester`, `HoursRequiredDefault`, `RegistrationLeadTimeDays`, `WaitlistAutoPromote`, `OrgDomainRestriction`, `RecurrenceHorizonWeeks`, etc. Lets officers change behavior without touching Apps Script.

### 3.10 `AuditLog`
Timestamp / Actor / Action / Details — written automatically whenever a script performs a consequential action (capacity override, manual attendance edit, org approval/rejection, waitlist promotion). Cheap insurance for trust and debugging; not member-facing.

### 3.11 Entity Relationships

```
Organizations 1───N Events 1───N Signups
                       │
                       └───N Attendance ──── (Member × Semester) ──► ServiceHoursSummary (computed)
Members 1───N Signups
Members 1───N Attendance
OrgProposals ──(approve)──► Organizations
RecurringEventTemplates 1───N Events
```

`Email` is the natural key linking `Members`, `Signups`, and `Attendance` — deliberately avoiding a surrogate `MemberID` join, since Forms captures email directly and Sheets `QUERY`/`VLOOKUP` joins are simplest on a single flat key.

---

## 4. Google Workspace Architecture

### 4.1 Sheets: one spreadsheet, not several
**Decision:** a single Google Sheet with multiple tabs, not one spreadsheet per table/semester.
**Why:** cross-tab formulas (`QUERY`, `VLOOKUP`, `SUMIFS`) work natively only within one spreadsheet. Splitting tables across spreadsheets forces `IMPORTRANGE`, which requires per-range authorization, is a common breakage point, and is exactly the kind of "silent failure a non-technical officer can't debug" this redesign is meant to eliminate (principle #4). Trade-off: a single sheet can grow large over many semesters — mitigated by semester archiving (§4.5), not by fragmenting the source of truth.

### 4.2 Forms: only for external, one-time submissions
**Decision:** Forms are used **only** where the submitter is an outside member submitting once — signup and org advocacy. Structured records that officers author and repeatedly edit (Events, Organizations) live directly in Sheet tabs with data-validation dropdowns, **not** in a Form.
**Why:** this is the direct fix for the original problem. Forms are good at "capture from many people, once." Sheets are good at "structured records a few trusted editors maintain." Using a Form for Events (as some redesigns might default to) would recreate a second source of truth for event data. Two forms only:
- **Member Signup Form** — restricted to the UGA Workspace domain, with **"Automatically collect respondent's email"** enabled. This is a specific, load-bearing decision: it removes the #1 cause of orphaned/mismatched records (typo'd emails) without any extra member effort, and it is the mechanism that lets `Signups`/`Attendance`/`Members` join reliably on `Email`. Event choice is a dropdown, refreshed on a time-driven trigger (~every 10–15 min) from `Events` where `Status=Open` and remaining capacity > 0.
- **Advocate-an-Organization Form** — open to all members, feeds `OrgProposals`, never writes directly to `Organizations`.

There is deliberately **no third form** for post-event attendance — that was the second duplicate source of truth in the old system. It's replaced by QR/roll-call check-in (§4.4), which requires zero member data entry.

### 4.3 Apps Script: one script project, modular files
**Decision:** a single container-bound Apps Script project (attached to the spreadsheet) split into focused files, not multiple separate script projects.
**Why:** one project means one place to view logs, one set of triggers, one deployment for the check-in web app, and one thing for a future Service Chair to find. Splitting into multiple projects would require cross-project Sheets API calls to coordinate — more moving parts for no functional benefit at this scale.

Recommended modules:
- `Config.gs` — reads `Settings`, exposes constants
- `Triggers.gs` — installable triggers: `onFormSubmit` (signup), `onFormSubmit` (org proposal), `onEdit` (Events sheet guardrails), nightly time-driven trigger (recurrence generation, auto-close, reminders)
- `SignupService.gs` — capacity check + waitlist assignment, using `LockService` to serialize concurrent submissions safely
- `AttendanceService.gs` — web app `doGet`/`doPost` for QR scans; roll-call checklist handler
- `EmailService.gs` — all Gmail sends (confirmation, waitlist, promotion, reminders, semester summary)
- `ReportingService.gs` — builds/refreshes the Officer Dashboard, generates exportable semester report
- `OrgProposalService.gs` — approve/reject actions, publishes into `Organizations`
- `Utilities.gs` — shared helpers (semester calc, code generation, validation)
- Custom menu (`onOpen`): **Atlas Admin** → Approve Org Proposals, Promote Waitlists Now, Rebuild Dashboard, Generate Semester Report — so officers never need to open the script editor for routine tasks.

### 4.4 Attendance / QR strategy
Three options considered:

| Option | Member effort | Reliability | Fraud risk |
|---|---|---|---|
| QR code, officer-scanned | Near zero (show a code) | High | Low — officer controls scan |
| Officer manual roll-call | Zero | Highest (no tech dependency) | Lowest |
| Self-check-in (member's own device/link) | Low | Medium (needs signal/battery) | Higher (buddy check-ins) |

**Recommendation: hybrid, officer-controlled.** QR (officer scans the member's confirmation-email QR, code payload is the `ConfirmationCode`, opened via the `AttendanceService` web app) as the default for larger or off-site events; a simple roll-call checklist (built from `Signups` filtered by `EventID`, checkbox → `onEdit` writes `Attendance`) as the zero-setup fallback for small events or connectivity dead zones. Self-check-in by the member's own device is **not** used as the primary method — it's the one option that lets a member check in an absent friend, which undermines the "one source of truth" principle for attendance data. QR image is generated with a formula (`=IMAGE(...)` against a QR-image endpoint) embedded in the confirmation email; the underlying `ConfirmationCode` is also shown as plain text so an officer can type it in manually if the QR image or scanner fails — no single point of failure for check-in.

### 4.5 Semester archiving
At semester rollover (officer-triggered menu action), `Signups`/`Attendance`/`Events` rows for the closed semester are copied to an `Archive` spreadsheet (or archive tabs), and the live tabs are filtered to current-semester only. This keeps dashboard `QUERY` formulas fast and keeps officers looking at a manageable, current-only view — directly serving principle #4 (a new officer shouldn't have to scroll through three years of history to find this week's event).

---

## 5. Recommended Folder Structure

This is the structure for the implementation repo (this repo), to be populated starting at Milestone 1:

```
atlas-service-system/
├── README.md
├── docs/
│   ├── requirements.md
│   ├── architecture.md              (this document)
│   ├── data-dictionary.md           (column-level spec per tab, generated from §3)
│   └── officer-handbook.md          (handoff guide — written at Milestone 7)
├── apps-script/
│   ├── src/
│   │   ├── Config.gs
│   │   ├── Triggers.gs
│   │   ├── SignupService.gs
│   │   ├── AttendanceService.gs
│   │   ├── EmailService.gs
│   │   ├── ReportingService.gs
│   │   ├── OrgProposalService.gs
│   │   └── Utilities.gs
│   └── appsscript.json              (manifest; .clasp.json holds the scriptId and is gitignored)
├── forms/
│   ├── member-signup-form-spec.md   (field list + validation rules — the live Form is a Google object, not code)
│   └── org-proposal-form-spec.md
├── sheets/
│   ├── schema/                      (one file per tab, mirrors §3)
│   └── seed-data/                   (sample CSVs for test/demo data)
├── tests/
│   └── apps-script/                 (unit tests + per-milestone manual test checklists)
└── deployment/
    ├── setup-guide.md               (create spreadsheet → clasp push → link Forms → enable triggers)
    └── clasp-deploy.md
```

`clasp` (Google's Apps Script CLI) is recommended so the script's version history lives in this git repo rather than only in the browser script editor — this is what makes the script reviewable, testable, and handoff-able the same way the rest of this repo is.

---

## 6. Implementation Roadmap

Each milestone is independently testable before the next begins.

| # | Milestone | Deliverable | Test / exit criteria |
|---|---|---|---|
| M0 | Environment setup | Spreadsheet created, `clasp` project scaffolded, `Settings` tab populated | `clasp push`/`pull` round-trips cleanly |
| M1 | Data model & core sheets | `Organizations`, `Events`, `Members`, `Settings` tabs with validation dropdowns + seed data | Manually add a sample org/event; invalid input (e.g. capacity < 3, bad email) is rejected by validation |
| M2 | Signup form + processing | Signup Form live, `onFormSubmit` capacity/waitlist logic, confirmation emails | Submit test signups past capacity; verify correct Confirmed/Waitlisted split and emails received |
| M3 | Attendance | QR web app + roll-call checklist, `Attendance` writes, hours awarded | Simulate both check-in paths; verify no double-counted or missing attendance |
| M4 | Service hours & dashboard | Live `ServiceHoursSummary`, Officer Dashboard tab, exportable semester report | Dashboard numbers match hand-computed expectations across several test states |
| M5 | Advocate-an-Org workflow | Proposal Form, `OrgProposals` tab, approve/reject menu action | Submit → approve → org is event-creatable; submit → reject → org never appears |
| M6 | Recurrence, auto-close, rollover | Template-driven event generation, registration auto-close, semester archiving | Templates generate correct future occurrences; expired registration auto-closes; rollover archives cleanly |
| M7 | Polish & handoff | Load test at target scale, officer handbook, permissions audit | 500-member/100-event synthetic run behaves correctly; a new reader can operate the system from the handbook alone |

The user's stated next step — "Milestone 1: the spreadsheet and data model" — corresponds directly to M1 above.

---

## 7. Risk Assessment

### Failure points
- **Concurrent signup spikes** (many members submitting the instant registration opens) can contend on the capacity-check lock. *Mitigation:* `LockService` around the capacity/waitlist decision; stagger `RegistrationOpensAt` across popular events rather than opening everything simultaneously.
- **Third-party QR image dependency** going down. *Mitigation:* confirmation email always also shows the plain-text `ConfirmationCode` an officer can type manually.
- **Gmail daily send quota** (Workspace accounts: ~1,500/day) could be strained by simultaneous confirmation + reminder + summary sends at 500 members. *Mitigation:* batch semester-summary emails, avoid unnecessary per-event reminders unless requested (V2), monitor quota in `ReportingService`.

### User confusion risks
- Members expecting the old multi-step process and not trusting a single-form signup. *Mitigation:* explicit confirmation email copy, one-time migration announcement, and retiring the old Sheet/Forms so there's no ambiguity about which system is live.
- Uncertainty about whether the waitlist requires further action. *Mitigation:* waitlist email explicitly states auto-promotion happens automatically, no action needed.

### Data integrity risks
- Duplicate signups from the same member/event. *Mitigation:* `onFormSubmit` checks `Email + EventID` uniqueness, auto-cancels the duplicate with a notice.
- Manual edits directly into computed tabs (`Attendance`, `ServiceHoursSummary`) bypassing the automated flow. *Mitigation:* protect those ranges to script/officer-only with a visible "do not hand-edit" note; log any manual override to `AuditLog`.
- Email typos. *Mitigated structurally* by domain-restricted, auto-collected email on the Signup Form (§4.2) — there is no free-text email field to typo.

### Scalability concerns
- `QUERY`-heavy dashboard formulas slow down as history accumulates across semesters. *Mitigation:* semester archiving (§4.5) keeps the live sheet's row count bounded to roughly one semester at a time.
- Google Sheets' ~10M-cell ceiling. At 500 members × 100 events/semester this is far off if archiving is followed, but is worth re-checking if usage grows well beyond current projections.
- Apps Script daily execution-time quota (Workspace: 90 min/day). *Mitigation:* prefer batched formula-based computation over per-row script loops wherever a `QUERY`/`SUMIFS` can do the same job.

### Google Workspace limitations
- Forms have no native "hide full events" logic; the event dropdown is only as fresh as the last time-driven refresh (~10–15 min). *Mitigation:* the real capacity check happens server-side at submit time regardless of what the dropdown showed, so a stale dropdown can only ever result in an (clearly-communicated) waitlist, never an overbooked event.
- Sheets has no real foreign-key enforcement. *Mitigation:* data-validation dropdowns sourced from named ranges (e.g., `Events!EventID`) prevent most free-text mismatches.
- A public check-in web app endpoint is technically reachable by anyone with the URL. *Mitigation:* the QR payload includes the unguessable `ConfirmationCode`, not a sequential ID, so a stray request without a valid code does nothing.

---

## 8. Future Enhancements

### Version 1 (Must Have — this design)
- Single signup form (name, email, event, transportation, driver availability, notes) with instant confirmation
- Event management: create orgs/events, recurring events, capacities, auto-close, optional waitlist
- QR + roll-call attendance
- Automatic service-hours calculation (completed, attended, remaining)
- Officer dashboard: upcoming events, spots remaining, full events, waitlists, transportation requests, attendance status, hours completion, exportable semester report
- Advocate-an-Organization workflow with officer review before publishing

### Version 2 (Nice to Have)
- Automated event reminder emails (24h / 1 week out)
- Member self-service view of their own hours (small web app, instead of email-only)
- Mobile-optimized check-in web app UI
- Slack/Discord digest of upcoming events and open slots
- Member voting/interest signal on proposed organizations

### Version 3 (Future Ideas)
- Migration off Sheets to a database-backed app (e.g., Firebase/Airtable) if scale outgrows this design
- Gamification / recognition (leaderboards, milestones)
- Integration with university-wide volunteer-tracking systems
- SMS reminders
- Host-organization self-service portal for direct attendance marking
- Live BI dashboard (Looker Studio) over the semester archive

---

## 9. Explicit Trade-off Notes

- **Single spreadsheet vs. multiple spreadsheets:** chose single, for join simplicity and one source of truth, at the cost of needing archiving discipline as data grows.
- **Computed `ServiceHoursSummary` vs. script-maintained ledger:** chose computed/live, so hours can never drift from `Attendance`, at the cost of `QUERY` recalculation overhead — acceptable at this scale, revisit only if it becomes visibly slow.
- **QR (officer-scanned) vs. self-check-in:** chose officer-controlled, trading a small amount of officer effort for attendance data members can't game.
- **One Apps Script project vs. several:** chose one, for a single debugging/deployment surface, at the cost of a larger single codebase — mitigated by the modular file split in §4.3.

---

*This document defines the system to be built. No code has been written. Implementation begins at Milestone 1 (§6) upon approval of this architecture.*
