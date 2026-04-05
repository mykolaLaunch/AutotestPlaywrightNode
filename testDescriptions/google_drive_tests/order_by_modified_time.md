# Google Drive order by updated_utc (Drive modifiedTime vs DB id) (English)


This document describes the `Google Drive order by updated_utc` test and its checks. The test validates ingestion order using `modifiedTime` from Google Drive.

## Purpose

Ensure that files with a newer `modifiedTime` in Google Drive correspond to smaller (earlier) `id` values in `raw.raw_item` for source `google-drive` and account `mykola@launchnyc.io`.

## Where the test lives

- Test: `tests/api/google_drive_tests.spec.ts` (case `Google Drive order by updated_utc`).
- Drive API repository: `src/testing/repositories/GoogleDriveRepository.ts`.
- DB repository: `src/db/repositories/RawItemRepository.ts`.
- Validator: `src/testing/validators/GoogleDriveExternalIdValidator.ts`.

## Inputs and sources

1) Database (via `RawItemRepository.getBySourceAndAccount`)
- Query: `raw.raw_item` filtered by `source = 'google-drive'` and `source_account = 'mykola@launchnyc.io'`.
- Output: `dbRows`.
- `external_id` is extracted from each row.

2) Google Drive API (via `GoogleDriveRepository.getFileDetailsByIds`)
- For each `external_id`, the test calls `drive.files.get` with fields:
  - `id`, `name`, `modifiedTime`, `parents`, `mimeType`, `owners`, `driveId`.
- Output: `detailsById` (metadata by id) plus error list for failed lookups.


## Logic steps

1. Load all DB rows for `source = 'google-drive'` and `source_account = 'mykola@launchnyc.io'`.
2. Extract and validate `external_id` values.
3. For each `external_id`, fetch Drive metadata via `files.get` to obtain `modifiedTime`.
4. Build items pairing DB `id` with Drive `modifiedTime`.
5. Sort items by `modifiedTime` ascending (older to newer).
6. For each adjacent pair, verify newer `modifiedTime` implies smaller DB `id`.
7. Aggregate errors and fail if any exist.
## Comparison logic

1) DB `external_id` validation
- Ensures `external_id` is non-empty and non-null.

2) Build the ordering dataset
- For each DB row, the test pairs DB `id` with Drive `modifiedTime` by `external_id`.
- Items include:
  - `id`, `externalId`, `modifiedTimeIso`, `modifiedTimeMs`, `name`.

3) Order check
- Items are sorted by `modifiedTime` ascending (older to newer).
- For each adjacent pair `current` and `next`:
  - if `current.modifiedTime` < `next.modifiedTime`, then `current.id` must be **greater** than `next.id`.
- If a newer file has a larger `id` (or an older file has a smaller `id`), it is flagged as an error.

Short rule: a file with `modifiedTime = 2026-03-25T18:26:52.457Z` must have a **smaller** `id` than a file with `modifiedTime = 2026-03-24T18:26:52.457Z`.

## Errors and discrepancy handling

- All errors are aggregated into `errors`:
  - `external_id` validation errors,
  - Drive API lookup errors (`files.get`),
  - missing `modifiedTime` for an `external_id`,
  - ordering mismatches between `modifiedTime` and DB `id`.
- If `errors.length > 0`, the test logs details to stdout and fails:
  - `expect(errors, errors.join('\n')).toHaveLength(0)`.

## What a failure means

1) Drive API errors
- Authorization problems, API outages, or lack of access to some files.

2) Invalid `external_id`
- DB contains rows with empty/invalid `external_id`.

3) Ingestion order mismatch
- DB `id` does not reflect the expected descending order as `modifiedTime` increases.

## Output logs

The test writes to stdout:
- DB row count,
- validation errors (if any),
- validator messages describing mismatches.

## Important notes

- The check relies entirely on `modifiedTime` from the Google Drive API.
- If Drive returns incomplete data for some `external_id`, the test fails.
- `source_account` is fixed to `mykola@launchnyc.io`.
