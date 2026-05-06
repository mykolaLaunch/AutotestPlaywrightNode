# Google Calendar order by updated time (English)

This document describes the `Calendar order by updated_time` test and its checks.

Purpose
- Verify that, for Google Calendar raw items in the database, later Calendar `updated` timestamps correspond to smaller `id` values.
- The `updated` timestamp is taken from the Calendar API (`events.list`) for the configured calendars.

Test location
- Test: `tests/api/google_calendar_tests.spec.ts` (case `Calendar order by updated_time`).

Configuration source
- API: `GET /admin/instances` (via `AdminInstancesRepository`).
- The test selects the enabled `google-calendar` instance with `settings.email = mykola@launchnyc.io`.
- Key fields from settings:
  - `calendarIds`: list of calendars used to fetch events.
  - `backfillDays`: optional cutoff for filtering events.

Data sources
- DB: `raw.raw_item` filtered by:
  - `source = 'google-calendar'`
  - `source_account = 'mykola@launchnyc.io'`
- Calendar API: `events.list` for each configured calendar with:
  - `singleEvents = true`
  - `showDeleted = false`
  - `timeMin` when `backfillDays` is set

Validation steps
1. Load Calendar instance settings and extract `calendarIds` and `backfillDays`.
2. Fetch Calendar events for the configured calendars and build a map of `external_id -> updated`.
3. Load DB rows for the target account and keep only rows with matching Calendar details.
4. Convert `id` to number and `updated` to epoch ms.
5. Sort by Calendar `updated` ascending (earlier → later) with `id` as a tie-breaker.
6. Ensure that when `updated` increases, `id` does not increase.

Fail conditions
- No enabled Google Calendar instance found for the target email.
- Missing or empty `calendarIds`.
- Any row has invalid `id` or missing Calendar `updated`.
- Any detected order violation in the adjacent-pair chain.

---

# Google Calendar order by updated time (Русский)

Этот документ описывает тест `Calendar order by updated_time` и его проверки.

Цель
- Проверить, что для элементов Google Calendar в БД более поздний `updated` из API соответствует меньшему `id`.
- Время `updated` берется из Calendar API (`events.list`) для подключенных календарей.

Расположение теста
- Тест: `tests/api/google_calendar_tests.spec.ts` (кейс `Calendar order by updated_time`).

Источник конфигурации
- API: `GET /admin/instances` (через `AdminInstancesRepository`).
- Выбирается включенный `google-calendar` инстанс с `settings.email = mykola@launchnyc.io`.
- Используемые поля:
  - `calendarIds`: список календарей для выборки событий.
  - `backfillDays`: опциональный период для фильтрации событий.

Источники данных
- БД: `raw.raw_item` с фильтрами:
  - `source = 'google-calendar'`
  - `source_account = 'mykola@launchnyc.io'`
- Calendar API: `events.list` по каждому календарю с параметрами:
  - `singleEvents = true`
  - `showDeleted = false`
  - `timeMin` при наличии `backfillDays`

Шаги валидации
1. Загрузить настройки инстанса и получить `calendarIds` и `backfillDays`.
2. Получить события из Calendar API и построить карту `external_id -> updated`.
3. Загрузить строки БД и оставить только те, для которых есть данные из Calendar API.
4. Привести `id` к числу и `updated` к epoch ms.
5. Отсортировать по `updated` по возрастанию с `id` как тайбрейкером.
6. Проверить, что при росте `updated` значение `id` не растет.

Условия падения
- Не найден включенный Google Calendar инстанс для email.
- Отсутствует или пустой список `calendarIds`.
- Есть строки с некорректным `id` или отсутствующим `updated`.
- Найдено нарушение порядка (adjacent-pair chain).
