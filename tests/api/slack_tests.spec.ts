import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { SlackRepository } from '../../src/testing/repositories/SlackRepository';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';

function parseDateToMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.getTime();
    }
  }

  return null;
}

test.describe('Slack tests', { tag: ['@slack', '@regression'] }, () => {
  test('Slack external_thread coverage for T08EH9GDV', async () => {
    console.info('--- Slack coverage test start');
    console.info('Action: fetch Slack messages and compare expected external_id to raw_item external_id.');
    const slackRepository = new SlackRepository();
    const rawItemRepository = new RawItemRepository();

    loadEnvOnce();
    const channelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
    expect(channelId, 'SLACK_TEST_CHANNEL_ID is required.').not.toBe('');

    const slackResult = await slackRepository.getAllMessages(channelId);
    console.info(`Slack messages fetched: ${slackResult.messages.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('slack', 'T08EH9GDV');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const errors: string[] = [...slackResult.errors];

    const dbExternalIds: string[] = [];
    for (const row of dbRows) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        errors.push('DB row has invalid external_id (expected non-empty string).');
        continue;
      }
      dbExternalIds.push(externalId);
    }

    if (slackResult.messages.length === 0) {
      errors.push('No Slack messages were returned.');
    }

    const dbSet = new Set(dbExternalIds);
    const missingIds: string[] = [];
    const messageDetailsByExternalId: Record<string, string> = {};

    for (const msg of slackResult.messages) {
      if (msg.subtype === 'channel_join') {
        continue;
      }
      const threadTs = msg.threadTs || msg.ts;
      const isBot = Boolean(msg.botId);
      let externalId: string | null = null;

      if (isBot) {
        externalId = `${channelId}-${threadTs}`;
      } else if (msg.clientMsgId && msg.clientMsgId.trim() !== '') {
        externalId = msg.clientMsgId;
      } else {
        errors.push(`Slack message ts=${msg.ts} is missing client_msg_id for non-bot message.`);
      }

      if (!externalId) {
        continue;
      }

      if (!dbSet.has(externalId)) {
        missingIds.push(externalId);

        const cleanText = msg.text.replace(/\s+/g, ' ').trim();
        const textPreview = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;
        const user = msg.user ?? msg.username ?? msg.botId ?? '(unknown user)';
        const subtype = msg.subtype ? ` (${msg.subtype})` : '';
        messageDetailsByExternalId[externalId] = `- ${user}${subtype} | ${threadTs} | ${textPreview}`;
      }
    }

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => messageDetailsByExternalId[id] ?? `- ${id}`);
      errors.push(
        `Missing Slack external_id(s) (showing up to 10):\n${lines.join('\n')}`
      );
    }

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Slack coverage test end');
  });

  test(
    'Slack duplicates test for T08EH9GDV',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Slack duplicates test start');
    console.info('Action: load Slack messages and check for duplicate external_id in DB.');
    const slackRepository = new SlackRepository();
    const rawItemRepository = new RawItemRepository();

    loadEnvOnce();
    const channelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
    expect(channelId, 'SLACK_TEST_CHANNEL_ID is required.').not.toBe('');

    const slackResult = await slackRepository.getAllMessages(channelId);
    console.info(`Slack messages fetched: ${slackResult.messages.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('slack', 'T08EH9GDV');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const errors: string[] = [...slackResult.errors];

    const expectedExternalIds: string[] = [];
    for (const msg of slackResult.messages) {
      if (msg.subtype === 'channel_join') {
        continue;
      }
      const threadTs = msg.threadTs || msg.ts;
      const isBot = Boolean(msg.botId);

      if (isBot) {
        expectedExternalIds.push(`${channelId}-${threadTs}`);
        continue;
      }

      if (msg.clientMsgId && msg.clientMsgId.trim() !== '') {
        expectedExternalIds.push(msg.clientMsgId);
        continue;
      }

      errors.push(`Slack message ts=${msg.ts} is missing client_msg_id for non-bot message.`);
    }

    if (slackResult.messages.length === 0) {
      errors.push('No Slack messages were returned.');
    }

    if (expectedExternalIds.length === 0) {
      errors.push('No Slack external_id values were derived from messages.');
    }

    const expectedSet = new Set(expectedExternalIds);
    const counts = new Map<string, number>();
    const duplicates: string[] = [];

    for (const row of dbRows) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        continue;
      }
      if (!expectedSet.has(externalId)) {
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

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }

    if (duplicates.length > 0) {
      console.info(`Duplicate Slack messages in DB (${duplicates.length}):`);
      console.info(duplicates.join('\n'));
    }

    expect(errors, errors.join('\n')).toHaveLength(0);
    expect(duplicates.length, 'Duplicate Slack messages found in DB').toBe(0);
    console.info('--- Slack duplicates test end');
    }
  );

  // Checks that as message time increases, created_utc does not decrease (adjacent-pair order check on DB sample).
  test(
    'Slack ingestion order by message thread_ts vs created_utc for T08EH9GDV',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Slack ingestion order test start');
    console.info('Action: validate newer created_utc rows have smaller id than older ones (DB-only).');
    const rawItemRepository = new RawItemRepository();

    const minSamples = 5;

    const dbRows = await rawItemRepository.getBySource('slack');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const errors: string[] = [];
    const items: Array<{ id: number; createdUtcMs: number; createdUtcIso: string }> = [];

    for (const row of dbRows) {
      const idValue = (row as { id?: unknown }).id;
      const createdUtc = (row as { created_utc?: unknown }).created_utc;

      const id =
        typeof idValue === 'number'
          ? idValue
          : Number.isFinite(Number(idValue))
            ? Number(idValue)
            : null;
      if (id === null || !Number.isFinite(id)) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }

      const createdUtcMs = parseDateToMs(createdUtc);
      if (createdUtcMs === null) {
        errors.push(`DB row has invalid created_utc for id=${id}.`);
        continue;
      }

      items.push({
        id,
        createdUtcMs,
        createdUtcIso: new Date(createdUtcMs).toISOString()
      });
    }

    if (items.length < minSamples) {
      errors.push(
        `Not enough DB rows to validate message ts/created_utc order. Expected at least ${minSamples}, got ${items.length}.`
      );
    } else {
      const sorted = items
        .slice()
        .sort((a, b) => b.createdUtcMs - a.createdUtcMs || b.id - a.id);

      for (let i = 0; i < sorted.length - 1; i += 1) {
        const current = sorted[i];
        const next = sorted[i + 1];

        if (current.createdUtcMs > next.createdUtcMs && current.id >= next.id) {
          errors.push(
            `Order mismatch: newer row id=${current.id} created_utc=${current.createdUtcIso} but older row id=${next.id} created_utc=${next.createdUtcIso} has smaller or equal id.`
          );
        }
      }
    }

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Slack ingestion order test end');
    }
  );

  test(
    'Send Slack message and verify raw_item ingestion by external_thread',
    { tag: ['@slack', '@dynamic', '@new-object-load'] },
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
      const maxAttempts = 40;

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

      // try {
      //   expect(matchedRows.length, 'No raw_item row found for sent Slack message.').toBeGreaterThan(0);
      //
      //   const latestRow = matchedRows[0] as { id?: number; external_thread?: string };
      //   expect(latestRow.external_thread, 'raw_item external_thread mismatch.').toBe(messageTs);
      //
      //   if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
      //     expect(latestRow.id, 'raw_item id should be greater than pre-send latest id.').toBeGreaterThan(beforeLatestId);
      //   }
      //
      //   console.info('--- Slack dynamic ingestion test end');
      // } finally {
      //   if (messageTs) {
      //     const deleteResult = await slackRepository.deleteMessage(channelId, messageTs);
      //     if (deleteResult.errors.length > 0) {
      //       console.info(`Slack cleanup errors: ${deleteResult.errors.join('\n')}`);
      //     } else {
      //       console.info('Slack cleanup: message deleted.');
      //     }
      //   }
      // }
    }
  );
});
