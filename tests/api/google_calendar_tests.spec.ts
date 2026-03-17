import { test, expect } from '@playwright/test';
import { GoogleCalendarRepository } from '../../src/testing/repositories/GoogleCalendarRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GoogleCalendarExternalIdValidator } from '../../src/testing/validators/GoogleCalendarExternalIdValidator';

test.describe('Google Calendar tests', () => {
  test('Calendar external_id coverage for mykola@launchnyc.io', async () => {
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

    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test('Calendar ingestion order by updated_utc vs id for mykola@launchnyc.io', async () => {
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

    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
