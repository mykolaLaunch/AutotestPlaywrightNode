# Test Descriptions

This file contains detailed explanations of automated tests.

## Gmail ingestion order by created_utc vs id for mykola@launchnyc.io

**Spec:** `tests/api/gmail_tests.spec.ts`

**Purpose**
Verify that, for Gmail raw items in the database, later `created_utc` timestamps do not correspond to larger `id` values. In other words, as `created_utc` increases, `id` should not increase within the sampled dataset.

**Data source**
`raw.raw_item` filtered by:
- `source = gmail`
- `source_account = mykola@launchnyc.io`

**Sampling**
- Up to 1000 rows are loaded (ordered by `created_utc` descending in the query).
- A minimum of 5 valid rows is required to run the ordering check.

**Validation steps**
1. **Row parsing**
   - `id` is accepted as a number or a numeric string and converted to `number`.
   - `created_utc` is parsed from `Date`, ISO string, or epoch (seconds/milliseconds).
   - Rows with invalid `id` or `created_utc` are collected as errors.

2. **Order check (pair chain)**
   - Valid rows are sorted by `created_utc` ascending (earlier → later), with `id` as a tie-breaker.
   - Each adjacent pair is compared:
     - If `created_utc(A) < created_utc(B)` but `id(A) < id(B)`, this is a violation.
   - Any violations are reported with the concrete timestamps and ids.

**Fail conditions**
- Not enough valid rows (less than 5).
- Any row has invalid `id` or `created_utc`.
- Any detected order violation in the adjacent-pair chain.

**Why adjacent pairs are enough**
If any later `created_utc` has a larger `id` than an earlier one, the inversion will appear between some adjacent pair in the list sorted by `created_utc`.

## Drive ingestion order by updated_utc vs id for me

**Spec:** `tests/api/google_drive_tests.spec.ts`

**Purpose**
Verify that, for Google Drive raw items in the database, later `updated_utc` timestamps do not correspond to smaller `id` values. In other words, as `updated_utc` increases, `id` should not decrease within the sampled dataset.

**Data source**
`raw.raw_item` filtered by:
- `source = google-drive`
- `source_account = me`

**Sampling**
- Up to 1000 rows are loaded (ordered by `created_utc` descending in the query).
- A minimum of 5 valid rows is required to run the ordering check.

**Validation steps**
1. **Row parsing**
   - `id` is accepted as a number or a numeric string and converted to `number`.
   - `updated_utc` is parsed from `Date`, ISO string, or epoch (seconds/milliseconds).
   - Rows with invalid `id` or `updated_utc` are collected as errors.

2. **Order check (pair chain)**
   - Valid rows are sorted by `updated_utc` ascending (earlier → later), with `id` as a tie-breaker.
   - Each adjacent pair is compared:
     - If `updated_utc(A) < updated_utc(B)` but `id(A) > id(B)`, this is a violation.
   - Any violations are reported with the concrete timestamps and ids.

**Fail conditions**
- Not enough valid rows (less than 5).
- Any row has invalid `id` or `updated_utc`.
- Any detected order violation in the adjacent-pair chain.

**Why adjacent pairs are enough**
If any later `updated_utc` has a smaller `id` than an earlier one, the inversion will appear between some adjacent pair in the list sorted by `updated_utc`.

## Calendar ingestion order by updated time vs id for mykola@launchnyc.io

**Spec:** `tests/api/google_calendar_tests.spec.ts`

**Purpose**
Verify that, for Google Calendar raw items in the database, later Calendar `updated` timestamps (from the Calendar API) correspond to smaller `id` values. In other words, as Calendar updated time increases, `id` should decrease within the matched dataset.

**Data source**
- `raw.raw_item` filtered by:
  - `source = google-calendar`
  - `source_account = mykola@launchnyc.io`
- Calendar API events list for configured calendars (`/admin/instances`), with `singleEvents=true` and optional `backfillDays` filter.

**Sampling**
- All DB rows for the account are loaded; only rows with Calendar API details are used.
- A minimum of 5 matched rows is required to run the ordering check.

**Validation steps**
1. **Row parsing**
  - `id` is accepted as a number or a numeric string and converted to `number`.
   - Calendar `updated` is parsed from the API response.
   - Rows with invalid `id` or missing Calendar details are collected as errors.

2. **Order check (pair chain)**
   - Valid rows are sorted by Calendar `updated` ascending (earlier → later), with `id` as a tie-breaker.
   - Each adjacent pair is compared:
     - If `updated(A) < updated(B)` but `id(A) < id(B)`, this is a violation.
   - Any violations are reported with the concrete timestamps and ids.

**Fail conditions**
- Not enough valid rows (less than 5).
- Any row has invalid `id` or missing Calendar `updated`.
- Any detected order violation in the adjacent-pair chain.

**Why adjacent pairs are enough**
If any later `updated_utc` has a smaller `id` than an earlier one, the inversion will appear between some adjacent pair in the list sorted by `updated_utc`.

## Slack external_thread coverage for T08EH9GDV

**Spec:** `tests/api/slack_tests.spec.ts`

**Purpose**
Verify that Slack thread timestamps from the test channel are present in `raw.raw_item` as `external_thread` values.

**Data source**
`raw.raw_item` filtered by:
- `source = slack`
- `source_account = T08EH9GDV`

**Validation steps**
1. Fetch Slack messages from the test channel and collect unique `thread_ts` (or `ts` when `thread_ts` is missing).
2. Load DB rows and extract `external_thread`.
3. Ensure every Slack thread timestamp exists in DB.

**Fail conditions**
- No Slack messages returned.
- Any DB row has invalid `external_thread`.
- Missing `external_thread` values for Slack messages.

## Slack ingestion order by message thread_ts vs created_utc for T08EH9GDV

**Spec:** `tests/api/slack_tests.spec.ts`

**Purpose**
Verify that, for Slack raw items in the database, later Slack `thread_ts` timestamps do not correspond to earlier `created_utc` timestamps. In other words, as message time increases, `created_utc` should not decrease within the sampled dataset.

**Data source**
`raw.raw_item` filtered by:
- `source = slack`
- `source_account = T08EH9GDV`

**Sampling**
- Up to 1000 rows are loaded (ordered by `created_utc` descending in the query).
- A minimum of 5 valid rows is required to run the ordering check.

**Validation steps**
1. **Row parsing**
   - `external_thread` is parsed as a Slack timestamp (`thread_ts`) and converted to epoch ms.
   - `created_utc` is parsed from `Date`, ISO string, or epoch (seconds/milliseconds).
   - Rows with invalid `external_thread` or `created_utc` are collected as errors.

2. **Order check (pair chain)**
   - Valid rows are sorted by Slack message time ascending (earlier → later), with `created_utc` as a tie-breaker.
   - Each adjacent pair is compared:
     - If message time(A) < message time(B) but created_utc(A) > created_utc(B), this is a violation.
   - Any violations are reported with concrete timestamps.

**Fail conditions**
- Not enough valid rows (less than 5).
- Any row has invalid `external_thread` or `created_utc`.
- Any detected order violation in the adjacent-pair chain.

**Why adjacent pairs are enough**
If any later Slack message time has an earlier `created_utc` than an earlier message, the inversion will appear between some adjacent pair in the list sorted by message time.
