# Google Calendar coverage config-based (English)

This document describes the `Calendar config-based external_id coverage for mykola@launchnyc.io` test and its checks.

Purpose
- Validate ingestion coverage for Google Calendar using instance configuration.
- Only events from the configured calendarIds are included.

Test location
- Test: `tests/api/google_calendar_tests.spec.ts` (case `Calendar config-based external_id coverage for mykola@launchnyc.io`).

Configuration source
- API: `GET /admin/instances` (via `AdminInstancesRepository`).
- The test selects the enabled `google-calendar` instance with `settings.email = mykola@launchnyc.io`.
- Key fields from settings:
  - `calendarIds`: list of calendars used for coverage.
  - `backfillDays`: optional cutoff for filtering events.

Data sources
- Google Calendar API: events list for configured calendars (optionally filtered by `backfillDays`).
- Events are fetched with `singleEvents=true` to expand recurring instances and avoid missing occurrences.
- DB: `raw.raw_item` filtered by:
  - `source = 'google-calendar'`
  - `source_account = 'mykola@launchnyc.io'`

Validation steps
1. Load Google Calendar instance settings and extract `calendarIds` and `backfillDays`.
2. Fetch Calendar event ids for the configured calendars using the backfill cutoff if present.
3. Load DB rows for the target account and validate `external_id`.
4. Ensure every configured Calendar event id exists in DB `external_id`.
5. If missing ids exist, log a preview (calendar name, date, summary).
6. Identify extra DB `external_id` values that are not present in the configured Calendar results, fetch details across calendars for a sample, and log calendar name, date, and summary (or `NOT FOUND`).

Fail conditions
- No enabled Google Calendar instance found for the target email.
- `calendarIds` missing in instance settings.
- Any DB row has invalid `external_id`.
- Any configured Calendar event id is missing in DB.
- Any extra DB `external_id` not present in the configured Calendar results.
