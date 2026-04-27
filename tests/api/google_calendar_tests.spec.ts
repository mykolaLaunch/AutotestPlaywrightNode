import { test, expect } from '../testLogger';
import { GoogleCalendarRepository } from '../../src/testing/repositories/GoogleCalendarRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GoogleCalendarExternalIdValidator } from '../../src/testing/validators/GoogleCalendarExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { Neo4jDataItemRepository } from '../../src/neo4j/Neo4jDataItemRepository';

test.describe('Google Calendar tests', { tag: ['@google-calendar', '@regression'] }, () => {
  test.skip('Calendar coverage for not config-based', async () => {
    console.info('--- Google Calendar coverage test start');
    console.info('Action: fetch Calendar event ids and compare to raw_item external_id.');
    const calendarRepository = new GoogleCalendarRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleCalendarExternalIdValidator();

    const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
    // const calendarResult = await calendarRepository.getAllEventIds(calendarId);
    const calendarAllResult = await calendarRepository.getAllEventIdsForAllCalendars();
    console.info(`Calendar id: ${calendarId}`);
    console.info(`Calendar event ids fetched: ${calendarAllResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-calendar', 'mykola@launchnyc.io');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const coverageResult = validator.validateEventIdsPresentInDb(
      calendarAllResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = calendarAllResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => {
        const detail = calendarAllResult.eventDetailsById[id];
        if (!detail) {
          return `- (unknown calendar) | unknown date | (unknown title)`;
        }
        const calendarName = detail.calendarName ?? detail.calendarId;
        return `- ${calendarName} | ${detail.date} | ${detail.summary}`;
      });
      missingDetailsErrors.push(
        `Missing Google Calendar events (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const errors = [
      ...calendarAllResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Calendar coverage test end');
  });

  test('Calendar config-based external_id coverage for mykola@launchnyc.io', async ({ request }) => {
    console.info('--- Calendar coverage (config-based) test start');
    console.info('Action: load Calendar instance settings and compare filtered event ids to raw_item external_id.');
    loadEnvOnce();

    const calendarRepository = new GoogleCalendarRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleCalendarExternalIdValidator();

    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const errors: string[] = [];
    const targetEmail = 'mykola@launchnyc.io';
    const calendarSettingsResult = await adminInstancesRepository.getGoogleCalendarSettingsForUserEmail(targetEmail);
    errors.push(...calendarSettingsResult.errors);

    const settings = (calendarSettingsResult.settings ?? {}) as Record<string, unknown>;
    const calendarIds = Array.isArray(settings.calendarIds)
      ? settings.calendarIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    const backfillDaysRaw = settings.backfillDays;
    const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
    const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

    console.info(`Using Google Calendar settings from instance id=${calendarSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`calendarIds: ${calendarIds.length > 0 ? calendarIds.join(', ') : '(none)'}`);
    console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

    if (calendarIds.length === 0) {
      errors.push('Google Calendar instance settings did not include calendarIds.');
    }

    const calendarResult = await calendarRepository.getEventIdsByCalendarIds(
      calendarIds,
      hasBackfillDays ? backfillDays : undefined
    );
    console.info(`Filtered Calendar event ids fetched: ${calendarResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-calendar', targetEmail);
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const calendarSet = new Set(calendarResult.ids);

    const coverageResult = validator.validateEventIdsPresentInDb(
      calendarResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = calendarResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => {
        const detail = calendarResult.eventDetailsById[id];
        if (!detail) {
          return `- (unknown calendar) | unknown date | (unknown title)`;
        }
        const calendarName = detail.calendarName ?? detail.calendarId;
        return `- ${calendarName} | ${detail.date} | ${detail.summary}`;
      });
      missingDetailsErrors.push(
        `Missing Google Calendar events (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const extraIds = dbExternalIdResult.externalIds.filter((id) => !calendarSet.has(id));
    const extraDetailsErrors: string[] = [];

    if (extraIds.length > 0) {
      console.info(`Extra Calendar events in DB (not in configured Calendar results): ${extraIds.length}`);
      const sampleIds = extraIds.slice(0, 50);
      const lookupResult = await calendarRepository.getEventDetailsByIdsAcrossCalendars(
        calendarIds,
        sampleIds
      );
      extraDetailsErrors.push(...lookupResult.errors);

      const lines = sampleIds.map((id) => {
        const detail = lookupResult.detailsById[id];
        if (!detail) {
          return `- ${id} | NOT FOUND`;
        }
        const calendarName = detail.calendarName ?? detail.calendarId;
        return `- ${id} | ${calendarName} | ${detail.date} | ${detail.summary}`;
      });

      extraDetailsErrors.push(
        `Extra Google Calendar events (showing up to 50):\n${lines.join('\n')}`
      );
    }

    errors.push(
      ...calendarResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors,
      ...extraDetailsErrors
    );

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Calendar coverage (config-based) test end');
  });

  test('Calendar config-based external_id coverage for mykola@launchnyc.io (neo4j)', async ({ request }) => {
    console.info('--- Calendar coverage (config-based, neo4j) test start');
    console.info('Action: load Calendar instance settings and compare filtered event ids to Neo4j DataItem.externalId.');
    loadEnvOnce();

    const calendarRepository = new GoogleCalendarRepository();
    const neo4jDataItemRepository = new Neo4jDataItemRepository();
    const validator = new GoogleCalendarExternalIdValidator();

    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const errors: string[] = [];
    const targetEmail = 'mykola@launchnyc.io';
    const calendarSettingsResult = await adminInstancesRepository.getGoogleCalendarSettingsForUserEmail(targetEmail);
    errors.push(...calendarSettingsResult.errors);

    const settings = (calendarSettingsResult.settings ?? {}) as Record<string, unknown>;
    const calendarIds = Array.isArray(settings.calendarIds)
      ? settings.calendarIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    const backfillDaysRaw = settings.backfillDays;
    const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
    const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

    console.info(`Using Google Calendar settings from instance id=${calendarSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`calendarIds: ${calendarIds.length > 0 ? calendarIds.join(', ') : '(none)'}`);
    console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

    if (calendarIds.length === 0) {
      errors.push('Google Calendar instance settings did not include calendarIds.');
    }

    const calendarResult = await calendarRepository.getEventIdsByCalendarIds(
      calendarIds,
      hasBackfillDays ? backfillDays : undefined
    );
    console.info(`Filtered Calendar event ids fetched: ${calendarResult.ids.length}`);

    const neo4jRows = await neo4jDataItemRepository.getBySourceAndAccount('google-calendar', targetEmail);
    console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);

    const rawExternalIds = neo4jRows.map((row) => row.externalId);
    const neo4jExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const neo4jSet = new Set(neo4jExternalIdResult.externalIds);
    const calendarSet = new Set(calendarResult.ids);

    const coverageResult = validator.validateEventIdsPresentInDb(
      calendarResult.ids,
      neo4jExternalIdResult.externalIds
    );

    const missingIds = calendarResult.ids.filter((id) => !neo4jSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => {
        const detail = calendarResult.eventDetailsById[id];
        if (!detail) {
          return '- (unknown calendar) | unknown date | (unknown title)';
        }
        const calendarName = detail.calendarName ?? detail.calendarId;
        return `- ${calendarName} | ${detail.date} | ${detail.summary}`;
      });
      missingDetailsErrors.push(
        `Missing Google Calendar events in Neo4j (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const extraIds = neo4jExternalIdResult.externalIds.filter((id) => !calendarSet.has(id));
    const extraDetailsErrors: string[] = [];

    if (extraIds.length > 0) {
      console.info(`Extra Calendar events in Neo4j (not in configured Calendar results): ${extraIds.length}`);
      const sampleIds = extraIds.slice(0, 50);
      const lookupResult = await calendarRepository.getEventDetailsByIdsAcrossCalendars(
        calendarIds,
        sampleIds
      );
      extraDetailsErrors.push(...lookupResult.errors);

      const lines = sampleIds.map((id) => {
        const detail = lookupResult.detailsById[id];
        if (!detail) {
          return `- ${id} | NOT FOUND`;
        }
        const calendarName = detail.calendarName ?? detail.calendarId;
        return `- ${id} | ${calendarName} | ${detail.date} | ${detail.summary}`;
      });

      extraDetailsErrors.push(
        `Extra Google Calendar events in Neo4j (showing up to 50):\n${lines.join('\n')}`
      );
    }

    errors.push(
      ...calendarResult.errors,
      ...neo4jExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors,
      ...extraDetailsErrors
    );

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Calendar coverage (config-based, neo4j) test end');
  });

  test(
    'Calendar duplicates',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Google Calendar duplicates test start');
    console.info('Action: load Calendar raw_item rows and check for duplicate external_id.');
    const rawItemRepository = new RawItemRepository();

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-calendar', 'mykola@launchnyc.io');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const counts = new Map<string, number>();
    const duplicates: string[] = [];

    for (const row of dbRows) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        continue;
      }
      const next = (counts.get(externalId) ?? 0) + 1;
      counts.set(externalId, next);
    }

    for (const [externalId, count] of counts.entries()) {
      if (count > 1) {
        duplicates.push(`${externalId} (count=${count})`);
      }
    }

    if (duplicates.length > 0) {
      console.info(`Duplicate Calendar events in DB (${duplicates.length}):`);
      console.info(duplicates.join('\n'));
    }

    expect(duplicates.length, 'Duplicate Calendar events found in DB').toBe(0);
    console.info('--- Google Calendar duplicates test end');
    }
  );

  test(
    'Calendar duplicates (neo4j)',
    { tag: ['@check-duplicates', '@neo4j'] },
    async () => {
      console.info('--- Google Calendar duplicates (neo4j) test start');
      console.info('Action: load Calendar DataItem rows from Neo4j and check for duplicate externalId.');
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const targetEmail = 'mykola@launchnyc.io';

      const duplicates = await neo4jDataItemRepository.getDuplicateExternalIdsBySourceAndAccount(
        'google-calendar',
        targetEmail
      );
      console.info(`Neo4j duplicate externalIds found: ${duplicates.length}`);

      if (duplicates.length > 0) {
        console.info(`Duplicate Calendar events in Neo4j (${duplicates.length}):`);
        const lines = duplicates.map((row) => `${row.externalId} (count=${row.count})`);
        console.info(lines.join('\n'));
      }

      expect(duplicates.length, 'Duplicate Calendar events found in Neo4j').toBe(0);
      console.info('--- Google Calendar duplicates (neo4j) test end');
    }
  );

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test(
    'Calendar order by updated_time',
    { tag: ['@order-test'] },
    async ({ request }) => {
    console.info('--- Google Calendar ingestion order test start');
    console.info('Action: validate Calendar updated time increases while DB id decreases.');
    loadEnvOnce();
    const rawItemRepository = new RawItemRepository();
    const calendarRepository = new GoogleCalendarRepository();
    const validator = new GoogleCalendarExternalIdValidator();
    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const minSamples = 5;

    const targetEmail = 'mykola@launchnyc.io';
    const calendarSettingsResult = await adminInstancesRepository.getGoogleCalendarSettingsForUserEmail(targetEmail);
    const settings = (calendarSettingsResult.settings ?? {}) as Record<string, unknown>;
    const calendarIds = Array.isArray(settings.calendarIds)
      ? settings.calendarIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    const backfillDaysRaw = settings.backfillDays;
    const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
    const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

    console.info(`Calendar instance id: ${calendarSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`calendarIds: ${calendarIds.length > 0 ? calendarIds.join(', ') : '(none)'}`);
    console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

    const calendarResult = await calendarRepository.getEventIdsByCalendarIds(
      calendarIds,
      hasBackfillDays ? backfillDays : undefined
    );
    console.info(`Filtered Calendar event ids fetched: ${calendarResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-calendar', targetEmail);
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const detailsById = calendarResult.eventDetailsById;
    const detailIds = new Set(Object.keys(detailsById));
    const filteredDbRows = dbRows.filter((row) => {
      const externalId = (row as { external_id?: unknown }).external_id;
      return typeof externalId === 'string' && detailIds.has(externalId);
    });
    console.info(`DB rows with Calendar details: ${filteredDbRows.length}`);

    const dbOrderResult = validator.buildCalendarUpdatedOrderItems(filteredDbRows, detailsById);
    const orderResult = validator.validateCalendarUpdatedTimeIdOrder(dbOrderResult.items, minSamples);

    const errors = [
      ...calendarSettingsResult.errors,
      ...calendarResult.errors,
      ...dbOrderResult.result.errors,
      ...orderResult.errors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Calendar ingestion order test end');
    }
  );

  test(
    'Calendar order by updated_time (neo4j)',
    { tag: ['@order-test', '@neo4j'] },
    async ({ request }) => {
      console.info('--- Google Calendar ingestion order (neo4j) test start');
      console.info('Action: validate Calendar updated time increases while Neo4j rawVersionId decreases.');
      loadEnvOnce();
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const calendarRepository = new GoogleCalendarRepository();
      const validator = new GoogleCalendarExternalIdValidator();
      const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
      const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

      const minSamples = 5;
      const targetEmail = 'mykola@launchnyc.io';
      const calendarSettingsResult = await adminInstancesRepository.getGoogleCalendarSettingsForUserEmail(targetEmail);
      const settings = (calendarSettingsResult.settings ?? {}) as Record<string, unknown>;
      const calendarIds = Array.isArray(settings.calendarIds)
        ? settings.calendarIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
        : [];
      const backfillDaysRaw = settings.backfillDays;
      const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
      const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

      console.info(`Calendar instance id: ${calendarSettingsResult.instance?.id ?? 'unknown'}`);
      console.info(`calendarIds: ${calendarIds.length > 0 ? calendarIds.join(', ') : '(none)'}`);
      console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

      const calendarResult = await calendarRepository.getEventIdsByCalendarIds(
        calendarIds,
        hasBackfillDays ? backfillDays : undefined
      );
      console.info(`Filtered Calendar event ids fetched: ${calendarResult.ids.length}`);

      const neo4jRows = await neo4jDataItemRepository.getBySourceAndAccount('google-calendar', targetEmail);
      console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);

      const detailsById = calendarResult.eventDetailsById;
      const detailIds = new Set(Object.keys(detailsById));
      const filteredNeo4jRows = neo4jRows.filter((row) => (
        typeof row.externalId === 'string' && detailIds.has(row.externalId)
      ));
      console.info(`Neo4j rows with Calendar details: ${filteredNeo4jRows.length}`);

      const neo4jOrderResult = validator.buildCalendarUpdatedOrderItemsFromNeo4j(filteredNeo4jRows, detailsById);
      const orderResult = validator.validateCalendarUpdatedTimeRawVersionIdOrder(
        neo4jOrderResult.items,
        minSamples
      );

      const errors = [
        ...calendarSettingsResult.errors,
        ...calendarResult.errors,
        ...neo4jOrderResult.result.errors,
        ...orderResult.errors
      ];

      if (errors.length > 0) {
        console.info(`Validation errors: ${errors.length}`);
        console.info(errors.join('\n'));
      }
      expect(errors, errors.join('\n')).toHaveLength(0);
      console.info('--- Google Calendar ingestion order (neo4j) test end');
    }
  );

  test(
    'Catch new Calendar event',
    { tag: ['@google-calendar', '@dynamic', '@new-object-load'] },
    async () => {
      console.info('--- Google Calendar dynamic ingestion test start');
      console.info('Action: find a free slot, create event, then poll raw_item by external_id.');

      loadEnvOnce();
      const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
      const timeZone = 'UTC';
      const durationMinutes = 30;
      const windowStartHour = 6;
      const windowEndHour = 22;
      const maxDays = 7;

      const calendarRepository = new GoogleCalendarRepository();
      const rawItemRepository = new RawItemRepository();

      const beforeLatestId = await rawItemRepository.getLatestId();
      console.info(`Latest raw_item id before create: ${beforeLatestId ?? 'null'}`);

      const now = new Date();
      const startDayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

      const findFreeSlot = async () => {
        for (let dayOffset = 0; dayOffset < maxDays; dayOffset += 1) {
          const day = new Date(Date.UTC(
            startDayUtc.getUTCFullYear(),
            startDayUtc.getUTCMonth(),
            startDayUtc.getUTCDate() + dayOffset
          ));

          const windowStart = new Date(Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            windowStartHour,
            0,
            0
          ));
          const windowEnd = new Date(Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            windowEndHour,
            0,
            0
          ));

          console.info(`Checking free slots for ${windowStart.toISOString().slice(0, 10)} UTC`);

          const eventsResult = await calendarRepository.getEventsInWindow(
            calendarId,
            windowStart.toISOString(),
            windowEnd.toISOString()
          );

          if (eventsResult.errors.length > 0) {
            console.info(eventsResult.errors.join('\n'));
            continue;
          }

          const events = eventsResult.events
            .map((e) => ({
              ...e,
              startMs: new Date(e.start).getTime(),
              endMs: new Date(e.end).getTime()
            }))
            .filter((e) => Number.isFinite(e.startMs) && Number.isFinite(e.endMs))
            .sort((a, b) => a.startMs - b.startMs);

          if (events.some((e) => e.isAllDay)) {
            console.info('All-day event found; skipping this day.');
            continue;
          }

          let candidateStartMs = windowStart.getTime();
          const durationMs = durationMinutes * 60 * 1000;

          for (const event of events) {
            if (event.startMs - candidateStartMs >= durationMs) {
              return {
                start: new Date(candidateStartMs),
                end: new Date(candidateStartMs + durationMs)
              };
            }
            candidateStartMs = Math.max(candidateStartMs, event.endMs);
          }

          if (windowEnd.getTime() - candidateStartMs >= durationMs) {
            return {
              start: new Date(candidateStartMs),
              end: new Date(candidateStartMs + durationMs)
            };
          }
        }

        return null;
      };

      const slot = await findFreeSlot();
      expect(slot, 'No free slot found in the next 7 days.').toBeTruthy();

      const timestamp = new Date().toISOString();
      const summary = `PW-CAL-INGESTION ${timestamp}`;

      let eventId: string | null = null;
      const createResult = await calendarRepository.createEvent({
        calendarId,
        summary,
        startIso: slot!.start.toISOString(),
        endIso: slot!.end.toISOString(),
        timeZone
      });

      console.info(`Created event id: ${createResult.id ?? 'null'}`);
      if (createResult.errors.length > 0) {
        console.info(createResult.errors.join('\n'));
      }

      expect(createResult.errors, createResult.errors.join('\n')).toHaveLength(0);
      expect(createResult.id, 'Calendar event id was not returned.').toBeTruthy();

      eventId = createResult.id as string;

      const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
      let matchedRows: Array<Record<string, unknown>> = [];

      const waitMs = 3000;
      const maxAttempts = 40;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rows = await rawItemRepository.getBySourceAndExternalId('google-calendar', eventId);
        const found = rows.length > 0;
        console.info(`Poll attempt ${attempt}/${maxAttempts}: found=${found} rows=${rows.length}`);
        attemptsLog.push({
          attempt,
          found,
          rowCount: rows.length,
          at: new Date().toISOString()
        });

        if (found) {
          matchedRows = rows;
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      try {
        expect(matchedRows.length, 'No raw_item row found for created Calendar event.').toBeGreaterThan(0);
        const latestRow = matchedRows[0] as { id?: number; external_id?: string };
        expect(latestRow.external_id, 'raw_item external_id mismatch.').toBe(eventId);

        if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
          expect(latestRow.id, 'raw_item id should be greater than pre-create latest id.').toBeGreaterThan(beforeLatestId);
        }

        console.info('--- Google Calendar dynamic ingestion test end');
      } finally {
        if (eventId) {
          const deleteResult = await calendarRepository.deleteEvent(calendarId, eventId);
          if (deleteResult.errors.length > 0) {
            console.info(`Calendar cleanup errors: ${deleteResult.errors.join('\n')}`);
          } else {
            console.info('Calendar cleanup: event deleted.');
          }
        }
      }
    }
  );

  test(
    'Catch new Calendar event (neo4j)',
    { tag: ['@google-calendar', '@dynamic', '@new-object-load', '@neo4j'] },
    async () => {
      console.info('--- Google Calendar dynamic ingestion (neo4j) test start');
      console.info('Action: find a free slot, create event, then poll Neo4j DataItem by externalId.');

      loadEnvOnce();
      const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
      const timeZone = 'UTC';
      const durationMinutes = 30;
      const windowStartHour = 6;
      const windowEndHour = 22;
      const maxDays = 7;
      const targetEmail = 'mykola@launchnyc.io';

      const calendarRepository = new GoogleCalendarRepository();
      const neo4jDataItemRepository = new Neo4jDataItemRepository();

      const beforeCount = await neo4jDataItemRepository.getCountBySourceAndAccount('google-calendar', targetEmail);
      const beforeLatestCreatedAt = await neo4jDataItemRepository.getLatestCreatedAtBySourceAndAccount(
        'google-calendar',
        targetEmail
      );
      console.info(`Neo4j DataItem count before create: ${beforeCount}`);
      console.info(`Neo4j latest createdAtUtc before create: ${beforeLatestCreatedAt ?? 'null'}`);

      const now = new Date();
      const startDayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

      const findFreeSlot = async () => {
        for (let dayOffset = 0; dayOffset < maxDays; dayOffset += 1) {
          const day = new Date(Date.UTC(
            startDayUtc.getUTCFullYear(),
            startDayUtc.getUTCMonth(),
            startDayUtc.getUTCDate() + dayOffset
          ));

          const windowStart = new Date(Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            windowStartHour,
            0,
            0
          ));
          const windowEnd = new Date(Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            windowEndHour,
            0,
            0
          ));

          console.info(`Checking free slots for ${windowStart.toISOString().slice(0, 10)} UTC`);

          const eventsResult = await calendarRepository.getEventsInWindow(
            calendarId,
            windowStart.toISOString(),
            windowEnd.toISOString()
          );

          if (eventsResult.errors.length > 0) {
            console.info(eventsResult.errors.join('\n'));
            continue;
          }

          const events = eventsResult.events
            .map((e) => ({
              ...e,
              startMs: new Date(e.start).getTime(),
              endMs: new Date(e.end).getTime()
            }))
            .filter((e) => Number.isFinite(e.startMs) && Number.isFinite(e.endMs))
            .sort((a, b) => a.startMs - b.startMs);

          if (events.some((e) => e.isAllDay)) {
            console.info('All-day event found; skipping this day.');
            continue;
          }

          let candidateStartMs = windowStart.getTime();
          const durationMs = durationMinutes * 60 * 1000;

          for (const event of events) {
            if (event.startMs - candidateStartMs >= durationMs) {
              return {
                start: new Date(candidateStartMs),
                end: new Date(candidateStartMs + durationMs)
              };
            }
            candidateStartMs = Math.max(candidateStartMs, event.endMs);
          }

          if (windowEnd.getTime() - candidateStartMs >= durationMs) {
            return {
              start: new Date(candidateStartMs),
              end: new Date(candidateStartMs + durationMs)
            };
          }
        }

        return null;
      };

      const slot = await findFreeSlot();
      expect(slot, 'No free slot found in the next 7 days.').toBeTruthy();

      const timestamp = new Date().toISOString();
      const summary = `PW-CAL-INGESTION-NEO4J ${timestamp}`;

      let eventId: string | null = null;
      const createResult = await calendarRepository.createEvent({
        calendarId,
        summary,
        startIso: slot!.start.toISOString(),
        endIso: slot!.end.toISOString(),
        timeZone
      });

      console.info(`Created event id: ${createResult.id ?? 'null'}`);
      if (createResult.errors.length > 0) {
        console.info(createResult.errors.join('\n'));
      }

      expect(createResult.errors, createResult.errors.join('\n')).toHaveLength(0);
      expect(createResult.id, 'Calendar event id was not returned.').toBeTruthy();

      eventId = createResult.id as string;

      const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
      let matchedRows: Awaited<ReturnType<Neo4jDataItemRepository['getBySourceAccountAndExternalId']>> = [];

      const waitMs = 3000;
      const maxAttempts = 40;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rows = await neo4jDataItemRepository.getBySourceAccountAndExternalId('google-calendar', targetEmail, eventId);
        const found = rows.length > 0;
        console.info(`Poll attempt ${attempt}/${maxAttempts}: found=${found} rows=${rows.length}`);
        attemptsLog.push({
          attempt,
          found,
          rowCount: rows.length,
          at: new Date().toISOString()
        });

        if (found) {
          matchedRows = rows;
          break;
        }

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }

      try {
        expect(matchedRows.length, 'No Neo4j DataItem row found for created Calendar event.').toBeGreaterThan(0);
        const latestRow = matchedRows[0];
        expect(latestRow.externalId, 'Neo4j DataItem externalId mismatch.').toBe(eventId);

        const afterCount = await neo4jDataItemRepository.getCountBySourceAndAccount('google-calendar', targetEmail);
        console.info(`Neo4j DataItem count after poll: ${afterCount}`);
        expect(afterCount, 'Neo4j DataItem count should not decrease after ingestion.').toBeGreaterThanOrEqual(beforeCount);
        console.info('--- Google Calendar dynamic ingestion (neo4j) test end');
      } finally {
        if (eventId) {
          const deleteResult = await calendarRepository.deleteEvent(calendarId, eventId);
          if (deleteResult.errors.length > 0) {
            console.info(`Calendar cleanup errors: ${deleteResult.errors.join('\n')}`);
          } else {
            console.info('Calendar cleanup: event deleted.');
          }
        }
      }
    }
  );
});
