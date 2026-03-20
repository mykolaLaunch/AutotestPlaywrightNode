import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { SlackRepository } from '../../src/testing/repositories/SlackRepository';
import { SlackExternalIdValidator } from '../../src/testing/validators/SlackExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';

test.describe('Slack tests', { tag: ['@slack', '@regression'] }, () => {
  test('Slack external_thread coverage for T08EH9GDV', async () => {
    console.info('--- Slack coverage test start');
    console.info('Action: fetch Slack thread timestamps and compare to raw_item external_thread.');
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

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Slack coverage test end');
  });

  // Checks that as message time increases, created_utc does not decrease (adjacent-pair order check on DB sample).
  test('Slack ingestion order by message thread_ts vs created_utc for T08EH9GDV', async () => {
    console.info('--- Slack ingestion order test start');
    console.info('Action: validate created_utc does not decrease as thread_ts increases.');
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

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Slack ingestion order test end');
  });

  test(
    'Send Slack message and verify raw_item ingestion by external_thread',
    { tag: ['@slack', '@dynamic'] },
    async () => {
      console.info('--- Slack dynamic ingestion test start');
      console.info('Action: send a Slack message and poll raw_item by external_thread.');

      const slackRepository = new SlackRepository();
      const rawItemRepository = new RawItemRepository();

      loadEnvOnce();
      const channelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
      expect(channelId, 'SLACK_TEST_CHANNEL_ID is required.').not.toBe('');

      const beforeLatestId = await rawItemRepository.getLatestId();
      console.info(`Latest raw_item id before send: ${beforeLatestId ?? 'null'}`);

      const timestamp = new Date().toISOString();
      const text = `PW-SLACK-INGESTION ${timestamp} (fixed body)`;

      let messageTs: string | null = null;
      const sendResult = await slackRepository.sendMessage({
        channel: channelId,
        text
      });

      console.info(`Slack send ok: ${sendResult.ok}`);
      if (sendResult.errors.length > 0) {
        console.info(sendResult.errors.join('\n'));
      }

      expect(sendResult.errors, sendResult.errors.join('\n')).toHaveLength(0);
      expect(sendResult.ok, 'Slack send did not succeed.').toBeTruthy();
      expect(sendResult.ts, 'Slack send did not return ts.').toBeTruthy();

      messageTs = sendResult.threadTs ?? sendResult.ts as string;
      console.info(`Sent Slack message ts: ${messageTs}`);

      const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
      let matchedRows: Array<Record<string, unknown>> = [];

      const waitMs = 3000;
      const maxAttempts = 10;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rows = await rawItemRepository.getBySourceAndExternalThread('slack', messageTs);
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
        expect(matchedRows.length, 'No raw_item row found for sent Slack message.').toBeGreaterThan(0);

        const latestRow = matchedRows[0] as { id?: number; external_thread?: string };
        expect(latestRow.external_thread, 'raw_item external_thread mismatch.').toBe(messageTs);

        if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
          expect(latestRow.id, 'raw_item id should be greater than pre-send latest id.').toBeGreaterThan(beforeLatestId);
        }

        console.info('--- Slack dynamic ingestion test end');
      } finally {
        if (messageTs) {
          const deleteResult = await slackRepository.deleteMessage(channelId, messageTs);
          if (deleteResult.errors.length > 0) {
            console.info(`Slack cleanup errors: ${deleteResult.errors.join('\n')}`);
          } else {
            console.info('Slack cleanup: message deleted.');
          }
        }
      }
    }
  );
});
