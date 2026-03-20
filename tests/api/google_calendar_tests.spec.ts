import { test, expect } from '../testLogger';
import { GoogleCalendarRepository } from '../../src/testing/repositories/GoogleCalendarRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GoogleCalendarExternalIdValidator } from '../../src/testing/validators/GoogleCalendarExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';

test.describe('Google Calendar tests', { tag: ['@google-calendar', '@regression'] }, () => {
  test('Calendar external_id coverage for mykola@launchnyc.io', async () => {
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

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test('Calendar ingestion order by updated_utc vs id for mykola@launchnyc.io', async () => {
    console.info('--- Google Calendar ingestion order test start');
    console.info('Action: validate updated_utc increases with id on DB sample.');
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleCalendarExternalIdValidator();

    const sampleLimit = 1000;
    const minSamples = 5;

    const dbRows = await rawItemRepository.getBySourceAndAccountLimited(
      'google-calendar',
      'mykola@launchnyc.io',
      sampleLimit
    );
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const dbOrderResult = validator.validateDbRowsForUpdatedUtcAndId(dbRows);
    const orderResult = validator.validateUpdatedUtcIdOrder(dbOrderResult.items, minSamples);

    const errors = [
      ...dbOrderResult.result.errors,
      ...orderResult.errors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Calendar ingestion order test end');
  });

  test(
    'Send Calendar event and verify raw_item ingestion by external_id',
    { tag: ['@google-calendar', '@dynamic'] },
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
      const maxAttempts = 10;

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
});
