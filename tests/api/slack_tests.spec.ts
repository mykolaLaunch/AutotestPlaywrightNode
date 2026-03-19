import { test, expect } from '@playwright/test';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { SlackRepository } from '../../src/testing/repositories/SlackRepository';
import { SlackExternalIdValidator } from '../../src/testing/validators/SlackExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';

test.describe('Slack tests', () => {
  test('Slack external_thread coverage for T08EH9GDV', async () => {
    const slackRepository = new SlackRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new SlackExternalIdValidator();

    loadEnvOnce();
    const channelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
    expect(channelId, 'SLACK_TEST_CHANNEL_ID is required.').not.toBe('');

    const slackResult = await slackRepository.getAllMessageIds(channelId);
    console.info(`Slack message ids fetched: ${slackResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('slack', 'T08EH9GDV');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalThreads = dbRows.map(
      (row) => (row as { external_thread?: unknown }).external_thread
    );
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalThreads);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const coverageResult = validator.validateSlackIdsPresentInDb(
      slackResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = slackResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => {
        const detail = slackResult.messageDetailsById[id];
        if (!detail) {
          return `- unknown | unknown date | (unknown message)`;
        }

        const cleanText = detail.text.replace(/\s+/g, ' ').trim();
        const textPreview = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;
        const user = detail.user ?? '(unknown user)';
        const subtype = detail.subtype ? ` (${detail.subtype})` : '';
        return `- ${user}${subtype} | ${detail.date} | ${textPreview}`;
      });
      missingDetailsErrors.push(
        `Missing Slack messages (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const errors = [
      ...slackResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors
    ];

    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  // Checks that as message time increases, created_utc does not decrease (adjacent-pair order check on DB sample).
  test('Slack ingestion order by message thread_ts vs created_utc for T08EH9GDV', async () => {
    const rawItemRepository = new RawItemRepository();
    const validator = new SlackExternalIdValidator();

    const sampleLimit = 1000;
    const minSamples = 5;

    const dbRows = await rawItemRepository.getBySourceAndAccountLimited('slack', 'T08EH9GDV', sampleLimit);
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const dbOrderResult = validator.validateDbRowsForCreatedUtcAndExternalThread(dbRows);
    const orderResult = validator.validateMessageCreatedUtcOrder(dbOrderResult.items, minSamples);

    const errors = [
      ...dbOrderResult.result.errors,
      ...orderResult.errors
    ];

    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
