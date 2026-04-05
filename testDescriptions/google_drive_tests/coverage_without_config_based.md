# Google Drive coverage without config-based (English)

This document describes the `Google Drive coverage without config-based` test and its checks.

## Purpose

Validate ingestion coverage for Google Drive: every file returned by the Drive API (after repository filters) must exist in `raw.raw_item` as `external_id` for source `google-drive` and account `mykola@launchnyc.io`.

## Where the test lives

- Test: `tests/api/google_drive_tests.spec.ts` (case `Google Drive coverage without config-based`).
- Drive API repository: `src/testing/repositories/GoogleDriveRepository.ts`.
- DB repository: `src/db/repositories/RawItemRepository.ts`.
- Validator: `src/testing/validators/GoogleDriveExternalIdValidator.ts`.

## Inputs and sources

1) Google Drive API (via `GoogleDriveRepository.getAllFileIds('me')`)
- Uses OAuth token from `secrets/token.json` and client from `secrets/google-oauth-client.json`.
- Request: `drive.files.list` with `q="trashed = false"`.
- Fields: `id`, `name`, `modifiedTime`, `parents`, `mimeType`, `owners`, `driveId`.
- Filters in the test repository:
  - Folders are excluded (`mimeType = application/vnd.google-apps.folder`).
  - Only files with extensions in the allow-list are kept (pdf/doc/docx/xls/xlsx/ppt/pptx/txt/log/csv/json/xml/yml/yaml/html/md).
- Outputs:
  - `driveResult.ids`: list of filtered file ids.
  - `driveResult.fileDetailsById`: metadata map per id (name, date, parents, mimeType, owners, driveId).

2) Database (via `RawItemRepository.getBySourceAndAccount`)
- Query: `raw.raw_item` filtered by `source = 'google-drive'` and `source_account = 'mykola@launchnyc.io'`.
- Output: `dbRows`, then `external_id` values are extracted.


## Logic steps

1. Fetch Drive file ids and details via `getAllFileIds('me')` (filtered by repo rules).
2. Fetch DB rows for `source = 'google-drive'` and `source_account = 'mykola@launchnyc.io'`.
3. Extract DB `external_id` values and validate they are non-empty strings.
4. Compare Drive ids against DB `external_id` to find missing ids.
5. For up to 10 missing ids, resolve parent folder names and log file metadata.
6. For those missing ids, call Drive `files.get` and log detailed results.
7. Aggregate all errors and fail the test if any exist.
## Comparison logic

1) DB external_id validation
- The validator checks that `external_id` is valid (non-empty / non-null) and builds `externalIds`.

2) Coverage comparison
- `driveResult.ids` are compared to `dbExternalIdResult.externalIds`.
- Missing DB ids are computed as `missingIds = driveResult.ids - dbExternalIds`.

3) Missing details (missingIds)
- The first 10 `missingIds` are expanded for logging.
- For those ids, the test resolves:
  - parent folder names via `resolveParentNames`.
  - metadata from `driveResult.fileDetailsById` (name, date, mimeType, owners, driveId).
- Additionally, direct lookup requests are executed:
  - `GoogleDriveRepository.getFileDetailsByIds(preview, 'me')` (Drive `files.get` per id).
  - Logs include `id`, `name`, `modifiedDate`, `mimeType`, `owners`, `parents`, `driveId`.
  - If not found, it logs `NOT FOUND`.

## Errors and discrepancy handling

- All errors are aggregated into `errors`:
  - Drive API errors (`driveResult.errors`),
  - DB external_id validation errors,
  - coverage errors (missing ids),
  - parent folder resolve errors,
  - `files.get` lookup errors.
- If `errors.length > 0`, the test logs details to stdout and fails:
  - `expect(errors, errors.join('\n')).toHaveLength(0)`.

## What a failure means

1) `missingIds` is not empty
- Files visible via Drive API (after filtering) are expected to be ingested, but are missing from DB.
- The log prints up to 10 missing entries with folder/date/name/type/owners and the `files.get` lookup result.

2) DB external_id errors
- DB contains rows with invalid `external_id` (null/empty).

3) Drive API errors
- Authorization issues, Drive API unavailability, or per-file `files.get` errors.

## Output logs

The test writes to stdout:
- count of Drive ids and DB rows,
- missing files list (up to 10) with details and folder names,
- `files.get` lookup results for missing ids.

## Important notes

- Coverage is checked against what the Drive API returns after repository filters, not all files in the account.
- If connector ingestion is limited by config/scope, `missingIds` are expected and the test will fail.
- In this project, `source_account` is fixed to `mykola@launchnyc.io`.

# Google Drive coverage without config-based

Этот документ описывает тест `Google Drive coverage without config-based` и его проверки.

## Назначение

Проверить покрытие ingestion по Google Drive: все файлы, которые возвращает Drive API (с учетом фильтров тестового репозитория), должны присутствовать в `raw.raw_item` как `external_id` для источника `google-drive` и аккаунта `mykola@launchnyc.io`.

## Где находится тест

- Тест: `tests/api/google_drive_tests.spec.ts` (кейс `Google Drive coverage without config-based`).
- Репозиторий Drive API: `src/testing/repositories/GoogleDriveRepository.ts`.
- Репозиторий БД: `src/db/repositories/RawItemRepository.ts`.
- Валидатор: `src/testing/validators/GoogleDriveExternalIdValidator.ts`.

## Входные данные и источники

1) Google Drive API (через `GoogleDriveRepository.getAllFileIds('me')`)
- Используется OAuth токен из `secrets/token.json` и клиент из `secrets/google-oauth-client.json`.
- Запрос: `drive.files.list` с `q="trashed = false"`.
- Поля: `id`, `name`, `modifiedTime`, `parents`, `mimeType`, `owners`, `driveId`.
- Фильтры в тестовом репозитории:
  - Исключаются папки (`mimeType = application/vnd.google-apps.folder`).
  - Оставляются только файлы с расширениями из allow‑list (pdf/doc/docx/xls/xlsx/ppt/pptx/txt/log/csv/json/xml/yml/yaml/html/md).
- Результаты:
  - `driveResult.ids`: список id отфильтрованных файлов.
  - `driveResult.fileDetailsById`: карта метаданных по id (имя, дата, parents, mimeType, owners, driveId).

2) База данных (через `RawItemRepository.getBySourceAndAccount`)
- Запрос: `raw.raw_item` по `source = 'google-drive'` и `source_account = 'mykola@launchnyc.io'`.
- Результат: список строк `dbRows`, затем извлекается `external_id`.

## Логика сравнения

1) Валидация DB external_id
- Валидатор проверяет, что `external_id` валиден (не пустой/не null) и строит массив `externalIds`.

2) Сравнение покрытия
- `driveResult.ids` сравниваются с `dbExternalIdResult.externalIds`.
- Отсутствующие в БД id вычисляются как `missingIds = driveResult.ids - dbExternalIds`.

3) Детализация расхождений (missingIds)
- Берутся первые 10 `missingIds` для подробного лога.
- Для них собираются:
  - имена родительских папок через `resolveParentNames`.
  - метаданные из списка `driveResult.fileDetailsById` (имя, дата, mimeType, owners, driveId).
- Дополнительно выполняются прямые lookup‑запросы по id:
  - `GoogleDriveRepository.getFileDetailsByIds(preview, 'me')`, это `drive.files.get` по каждому id.
  - Логируется результат: `id`, `name`, `modifiedDate`, `mimeType`, `owners`, `parents`, `driveId`.
  - Если файл не найден, выводится `NOT FOUND`.

## Как обрабатываются ошибки и расхождения

- Все ошибки собираются в общий массив `errors`:
  - ошибки Drive API (`driveResult.errors`),
  - ошибки валидации DB external_id,
  - ошибки покрытия (отсутствующие id),
  - ошибки резолва родительских папок,
  - ошибки lookup‑запросов `files.get`.
- Если `errors.length > 0`, тест печатает детали в stdout и падает:
  - `expect(errors, errors.join('\n')).toHaveLength(0)`.

## Что означает падение теста

1) `missingIds` не пустой
- Есть файлы, которые видны через Drive API (после фильтрации) и должны быть в ingestion, но в БД их нет.
- В логе будет список (до 10) с папкой/датой/именем/типом/владельцем и результат `files.get`.

2) Ошибка в DB external_id
- В БД есть строки с некорректным `external_id` (null/пустая строка).

3) Ошибка Drive API
- Проблема авторизации, недоступность Drive API или ошибки отдельных `files.get`.

## Выходные логи

Тест пишет в stdout:
- количество id из Drive и количество строк из БД,
- список missing файлов (до 10) с деталями и папками,
- результаты lookup‑запросов `files.get` по missing id.

## Важные замечания

- Это покрытие сравнивает именно **то, что вернул Drive API после фильтров репозитория**, а не все файлы аккаунта.
- Если ingestion ограничен конфигом/скоупом коннектора, то `missingIds` будут ожидаться, и тест упадет.
- В этом проекте `source_account` фиксирован как `mykola@launchnyc.io`.
