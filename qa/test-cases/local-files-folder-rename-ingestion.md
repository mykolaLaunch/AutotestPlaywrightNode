# TC-LF-RENAME-001 (Draft)

- ID: `TC-LF-RENAME-001`
- Title: File-system connector ingests new file after watched folder rename
- Priority: High
- Scope: Local file-system connector ingestion
- Automation candidate: Yes
- Status: Draft

## Preconditions

- API is reachable (`API_BASE_URL`, default `https://localhost:5198`).
- At least one `file-system` connector instance exists in `/admin/instances` and can be updated.
- Test runner has local FS write permissions in repository workspace.

## Test Data

- `folderA`: `pw-rename-<timestamp>/folder-A`
- `folderB`: `pw-rename-<timestamp>/folder-B`
- `file1`: `folderA/file-1.txt`
- `file2`: `folderB/file-2.txt`

## Steps

1. Create `folderA` and create `file1` inside it.
2. Update file-system connector settings and append `folderA` into `settingsJson.roots[]`.
3. Poll DB (`raw.raw_item`) by `source=file-system` and `external_id=file1` until ingested.
4. Rename `folderA` to `folderB`.
5. Create `file2` inside `folderB`.
6. Trigger `/admin/connectors/rescan`.
7. Poll DB for `external_id=file2` until ingested.

## Expected Results

- Step 3: `file1` appears in DB as ingested local file.
- Step 7: `file2` appears in DB after folder rename and rescan.
- No API/validation errors during connector update and rescan.

## Notes

- Cleanup must restore original connector settings and remove test folders.
- If no updatable `file-system` instance exists, test should fail with explicit reason.
