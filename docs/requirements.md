# Requirements — Atlas Service Events System

Source: Atlas Business Society (University of Georgia) redesign request. This document restates the requirements the architecture in `docs/architecture.md` was designed against, for traceability.

## Problem
The current system has three disconnected sources of truth: an editable Google Sheet for signups, a separate logistics Google Form, and a second post-event attendance Google Form. Members inconsistently complete these, and officers manually reconcile data each semester.

## Design Priorities (highest to lowest)
1. One source of truth — a single member action reserves a spot; no duplicate entry.
2. Minimal member effort — signup takes under a minute; members always know if they succeeded.
3. Minimal officer maintenance — no manual copying; capacity, hours, and reports are automatic.
4. Simple handoff — a non-technical future Service Chair can learn the system quickly.
5. Scalable — 500+ members, 100+ events, multiple semesters, multiple concurrent officers.

## Required Features
- **Event management:** create organizations, create recurring events, set capacities, auto-close registration, optional waitlist.
- **Member signup:** one workflow capturing name, email, event, transportation needs, driver availability, notes; instant confirmation of success.
- **Attendance:** simplest reliable verification (QR check-in and/or officer roll-call), minimizing member effort.
- **Service hours:** automatic calculation of hours completed, events attended, semester totals, remaining hours required.
- **Officer dashboard:** live view of upcoming events, spots remaining, full events, waitlists, transportation requests, attendance status, hours completion; exportable semester reports.
- **Advocate-an-organization workflow:** members submit org name, contact info, description, and confirmation the org can host ≥ 3 Atlas members simultaneously; officers review before publishing.

## Constraints
- Favor simplicity over cleverness; minimize Apps Script complexity where possible.
- Design for non-technical future officers.
- Every major design decision must include a short rationale.
- Where multiple valid approaches exist, compare them and recommend one with trade-offs stated.

## Deliverable for this phase
A complete system architecture (no code): high-level workflow, data model, Google Workspace architecture, folder structure, implementation roadmap, risk assessment, and future enhancements split into V1/V2/V3. See `docs/architecture.md`.
