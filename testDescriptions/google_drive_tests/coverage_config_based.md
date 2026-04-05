# Google Drive coverage config-based (English)

This document describes the `Google Drive config-based external_id coverage for mykola@launchnyc.io` test and its checks.

Purpose
- Validate ingestion coverage for Google Drive using instance configuration.
- Only files that belong to the configured folderIds (and their descendants) are included.

Test location
- Test: `tests/api/google_drive_tests.spec.ts` (case `Google Drive config-based external_id coverage for mykola@launchnyc.io`).

Configuration source
- API: `GET /admin/instances` (via `AdminInstancesRepository`).
- The test selects the enabled `google-drive` instance with `settings.email = mykola@launchnyc.io`.
- Key fields from settings:
  - `folderIds`: list of root folder ids (e.g., `myDrive`) used for coverage.
  - `folderPaths`: optional mapping to display folder names in logs.
  - `includeMimeTypes` / `excludeMimeTypes`: optional filters applied to Drive API queries.

Data sources
- Drive API: recursive listing of all files in the configured folders (excluding folders).
- DB: `raw.raw_item` filtered by:
  - `source = 'google-drive'`
  - `source_account = 'mykola@launchnyc.io'`

Validation steps
1. Load Google Drive instance settings and extract `folderIds`, `includeMimeTypes`, `excludeMimeTypes`.
2. Fetch Drive file ids within the configured folder tree.
3. Load DB rows for the target account and validate `external_id`.
4. Ensure every configured Drive file id exists in DB `external_id`.
5. If missing ids exist, log a preview of missing files with parent folders, modified date, and name.
6. Identify extra DB `external_id` values that are not present in the configured Drive results, fetch Drive details for a sample, and log folder names, modified date, file name, mime type, owners, and driveId (or `NOT FOUND`).

Fail conditions
- No enabled Google Drive instance found for the target email.
- `folderIds` missing in instance settings.
- Any DB row has invalid `external_id`.
- Any configured Drive file id is missing in DB.
- Any extra DB `external_id` not present in the configured Drive results.

---

# Google Drive coverage config-based (Русский)

Этот документ описывает тест `Google Drive config-based external_id coverage for mykola@launchnyc.io` и его проверки.

Цель
- Проверить покрытие ingestion по Google Drive на основе конфигурации инстанса.
- В проверку входят только файлы из подключенных папок/дисков (folderIds) и их поддеревьев.

Расположение теста
- Тест: `tests/api/google_drive_tests.spec.ts` (кейс `Google Drive config-based external_id coverage for mykola@launchnyc.io`).

Источник конфигурации
- API: `GET /admin/instances` (через `AdminInstancesRepository`).
- Выбирается включенный `google-drive` инстанс с `settings.email = mykola@launchnyc.io`.
- Используемые поля:
  - `folderIds`: список корневых папок (например, `myDrive`) для выборки.
  - `folderPaths`: опциональные подписи папок для логов.
  - `includeMimeTypes` / `excludeMimeTypes`: опциональные фильтры MIME-типов.

Источники данных
- Drive API: рекурсивный список файлов из подключенных папок (без папок).
- БД: `raw.raw_item` с фильтрами:
  - `source = 'google-drive'`
  - `source_account = 'mykola@launchnyc.io'`

Шаги валидации
1. Загрузить настройки инстанса и получить `folderIds`, `includeMimeTypes`, `excludeMimeTypes`.
2. Получить id файлов Google Drive из подключенных папок.
3. Загрузить строки БД и проверить `external_id`.
4. Проверить, что все id файлов из конфигурации присутствуют в БД.
5. При отсутствии id вывести список пропусков с папкой, датой и именем файла.
6. Найти лишние `external_id` в БД, которых нет в результатах Drive, и вывести детали (папки, дата, имя, mime type, owners, driveId) или `NOT FOUND`.

Условия падения
- Не найден включенный Google Drive инстанс для email.
- В настройках нет `folderIds`.
- В БД есть некорректные `external_id`.
- В БД отсутствуют id файлов из конфигурации.
- В БД есть лишние `external_id`, которых нет в результатах Drive.
