# Catch Google Drive new file (English)
??????? ?????? ????.

This document describes the `Catch Google Drive new file` test and its checks. The test validates dynamic ingestion: a newly created Drive file should appear in `raw.raw_item`.

## Purpose

Verify that when a new file is created in Google Drive, ingestion inserts a corresponding row in `raw.raw_item` for source `google-drive` and that its `external_id` matches the Drive file id.

## Where the test lives

- Test: `tests/api/google_drive_tests.spec.ts` (case `Catch Google Drive new file`).
- Drive API repository: `src/testing/repositories/GoogleDriveRepository.ts`.
- DB repository: `src/db/repositories/RawItemRepository.ts`.

## Inputs and sources

1) Google Drive API (create/delete)
- File creation via `GoogleDriveRepository.createTextFile` using Drive `files.create`.
- Created file is a `.txt` with a timestamp in the name.
- Cleanup deletes the created file via `GoogleDriveRepository.deleteFile` (`files.delete`).

2) Database (polling)
- DB is queried by `RawItemRepository.getBySourceAndExternalId` for `source = 'google-drive'` and the created file id.
- The test also reads the latest raw_item id before create (`getLatestId`) to ensure ingestion advances the id.


## Logic steps

1. Read latest DB id via `getLatestId` (baseline).
2. Create a new Drive text file and capture its id.
3. Poll DB for `source = 'google-drive'` and `external_id = fileId`.
4. When found, validate row count > 0 and `external_id` matches file id.
5. If baseline id exists, assert new DB id is greater.
6. Delete the created Drive file (cleanup).
7. Aggregate errors and fail if any exist.
## Flow

1) Read `beforeLatestId` from DB (`raw.raw_item`) using `getLatestId`.
2) Create a Drive text file.
3) Poll DB up to 40 attempts with 3s delay:
   - `getBySourceAndExternalId('google-drive', fileId)`.
4) Once a row is found:
   - Assert at least one row exists.
   - Assert `external_id` equals the Drive file id.
   - If `beforeLatestId` is known, assert the new `id` is greater.
5) Delete the Drive file (cleanup), logging any deletion errors.

## Polling parameters

- `waitMs = 3000` milliseconds.
- `maxAttempts = 40` (max total wait ~120s).

## Errors and discrepancy handling

- Any errors from `createTextFile` fail the test immediately.
- If no DB rows are found after polling, the test fails.
- If `external_id` mismatches, the test fails.
- If the new DB `id` is not greater than `beforeLatestId`, the test fails.
- Cleanup errors are logged but do not fail the test.

## What a failure means

1) Drive create failed
- OAuth/permissions issues or Drive API error.

2) Ingestion pipeline is delayed or broken
- The created file never appears in `raw.raw_item` within the polling window.

3) DB mismatch
- `external_id` does not match the created Drive file id.
- `id` ordering does not increase for the new ingestion event.

## Output logs

The test writes to stdout:
- latest DB id before create,
- created Drive file id,
- polling attempts with found/row count,
- cleanup status.

## Important notes

- The created file name is `PW-DRIVE-INGESTION <timestamp>.txt`.
- The test requires Drive API credentials in `secrets/token.json` and `secrets/google-oauth-client.json`.
