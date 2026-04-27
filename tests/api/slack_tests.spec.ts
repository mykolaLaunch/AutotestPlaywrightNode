import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { SlackRepository } from '../../src/testing/repositories/SlackRepository';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { SlackExternalIdValidator } from '../../src/testing/validators/SlackExternalIdValidator';
import { Neo4jDataItemRepository } from '../../src/neo4j/Neo4jDataItemRepository';

test.describe('Slack tests', { tag: ['@slack', '@regression'] }, () => {
  test.skip('Slack external_thread coverage for T08EH9GDV', async () => {
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

  test('Slack external_id coverage v2  config based', async ({ request }) => {
    console.info('--- Slack coverage v2 test start');
    console.info('Action: load Slack instance settings and compare filtered Slack messages to raw_item external_id.');
    loadEnvOnce();

    const slackRepository = new SlackRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new SlackExternalIdValidator();

    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const errors: string[] = [];
    const workspaceId = 'T08EH9GDV';

    const slackSettingsResult = await adminInstancesRepository.getSlackSettingsForWorkspace(workspaceId);
    errors.push(...slackSettingsResult.errors);

    const workspaceSettings = (slackSettingsResult.settings?.workspace as Record<string, unknown> | undefined) ?? {};
    const channelIds = Array.isArray(workspaceSettings.channelIds)
      ? workspaceSettings.channelIds.filter((id) => typeof id === 'string') as string[]
      : [];
    const includeDms = Boolean(workspaceSettings.includeDms);
    const includeGroups = Boolean(workspaceSettings.includeGroups);
    const includePublicChannels = Boolean(workspaceSettings.includePublicChannels);
    const skipArchived = Boolean(workspaceSettings.skipArchivedChannels);
    const includeThreads = Boolean(workspaceSettings.includeThreads);

    const backfillDaysRaw = workspaceSettings.backfillDays;
    const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
    const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

    console.info(`Using Slack settings from instance id=${slackSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`workspaceId: ${workspaceId}`);
    console.info(`channelIds: ${channelIds.length > 0 ? channelIds.join(', ') : '(none)'}`);
    console.info(`includeDms=${includeDms} includeGroups=${includeGroups} includePublicChannels=${includePublicChannels} skipArchived=${skipArchived} includeThreads=${includeThreads}`);
    console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

    const slackResults = await slackRepository.getMessagesForChannels(channelIds, {
      includeThreads
    });

    const slackMessages = slackResults.flatMap((result) => result.messages.map((msg) => ({
      ...msg,
      channelId: result.channelId
    })));
    const slackErrors = slackResults.flatMap((result) =>
      result.errors.map((err) => `[channel ${result.channelId}] ${err}`)
    );
    errors.push(...slackErrors);

    console.info(`Slack messages fetched: ${slackMessages.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('slack', workspaceId);
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);

    const cutoffMs =
      hasBackfillDays ? Date.now() - Math.floor(backfillDays) * 24 * 60 * 60 * 1000 : null;
    const cutoffIso = cutoffMs ? new Date(cutoffMs).toISOString().slice(0, 10) : null;

    const expectedExternalIds: string[] = [];
    const messageDetailsByExternalId: Record<string, string> = {};
    const clientMsgIdMap = new Map<string, { channelId: string; ts: string }>();

    for (const msg of slackMessages) {
      if (msg.subtype === 'channel_join') {
        continue;
      }
      const threadTs = msg.threadTs || msg.ts;
      const messageMs = Number(threadTs) * 1000;
      if (cutoffMs !== null && (!Number.isFinite(messageMs) || messageMs < cutoffMs)) {
        continue;
      }

      const isBot = Boolean(msg.botId);
      let externalId: string | null = null;

      if (isBot) {
        externalId = `${msg.channelId}-${threadTs}`;
      } else if (msg.clientMsgId && msg.clientMsgId.trim() !== '') {
        externalId = msg.clientMsgId;
      } else {
        errors.push(`Slack message ts=${msg.ts} is missing client_msg_id for non-bot message.`);
      }

      if (!externalId) {
        continue;
      }

      expectedExternalIds.push(externalId);
      if (!isBot && msg.clientMsgId) {
        clientMsgIdMap.set(msg.clientMsgId, { channelId: msg.channelId, ts: msg.ts });
      }

      const cleanText = msg.text.replace(/\s+/g, ' ').trim();
      const textPreview = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;
      const user = msg.user ?? msg.username ?? msg.botId ?? '(unknown user)';
      const subtype = msg.subtype ? ` (${msg.subtype})` : '';
      const dateText = new Date(messageMs).toISOString().slice(0, 10);
      messageDetailsByExternalId[externalId] = `- ${user}${subtype} | channel=${msg.channelId} | ${dateText} | ${textPreview}`;
    }

    const expectedUnique = [...new Set(expectedExternalIds)];
    console.info(`Expected Slack external_id count (after filters): ${expectedUnique.length}`);

    const coverageResult = validator.validateSlackIdsPresentInDb(
      expectedUnique,
      dbExternalIdResult.externalIds
    );

    const missingIds = expectedUnique.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      console.info(`Missing Slack messages in DB: ${missingIds.length}`);
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => messageDetailsByExternalId[id] ?? `- ${id}`);
      missingDetailsErrors.push(
        `Missing Slack external_id(s) (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const expectedSet = new Set(expectedUnique);
    const channelJoinPattern = /^[A-Z0-9]+-channel_join-\d+(\.\d+)?$/;
    const ignoredChannelJoin = dbExternalIdResult.externalIds.filter((id) => channelJoinPattern.test(id));
    const extraIds = dbExternalIdResult.externalIds.filter(
      (id) => !expectedSet.has(id) && !channelJoinPattern.test(id)
    );
    const extraDetailsErrors: string[] = [];

    if (ignoredChannelJoin.length > 0) {
      console.info(`Ignoring Slack channel_join system messages in DB: ${ignoredChannelJoin.length}`);
      const preview = ignoredChannelJoin.slice(0, 10);
      console.info(`Ignored channel_join examples (up to 10): ${preview.join(', ')}`);
    }

    if (extraIds.length > 0) {
      console.info(`Extra Slack messages in DB (not in filtered Slack API results): ${extraIds.length}`);
      const sampleIds = extraIds.slice(0, 50);
      const reasonsCounts = { channel: 0, date: 0, unknown: 0 };

      const lines = sampleIds.map((id) => {
        const isBot = id.includes('-');
        const parts = id.split('-');
        const channelJoin = isBot && parts[1] === 'channel_join';

        let channelFromId: string | null = null;
        let messageTs: string | null = null;

        if (isBot) {
          channelFromId = parts[0] ?? null;
          messageTs = channelJoin ? parts[2] ?? null : parts.slice(1).join('-');
        } else {
          const mapped = clientMsgIdMap.get(id);
          channelFromId = mapped?.channelId ?? null;
          messageTs = mapped?.ts ?? null;
        }

        const messageMs = messageTs ? Number(messageTs) * 1000 : null;

        let reason = 'unknown';
        if (channelJoin) {
          reason = 'channel_join';
        } else if (cutoffMs !== null) {
          if (messageMs !== null && Number.isFinite(messageMs) && messageMs < cutoffMs) {
            reason = 'date';
          } else if (messageMs === null || !Number.isFinite(messageMs)) {
            reason = 'date';
          }
        } else if (channelFromId && channelIds.length > 0 && !channelIds.includes(channelFromId)) {
          reason = 'channel';
        }

        if (reason === 'date') reasonsCounts.date += 1;
        else if (reason === 'channel') reasonsCounts.channel += 1;
        else if (reason === 'channel_join') reasonsCounts.unknown += 1;
        else reasonsCounts.unknown += 1;

        const dateText = messageMs ? new Date(messageMs).toISOString().slice(0, 10) : 'unknown date';
        const cutoffText = cutoffIso ? ` (cutoff ${cutoffIso})` : '';
        return `- ${id} | date=${dateText}${cutoffText} | reason=${reason}`;
      });

      console.info(
        `Extra Slack mismatch reasons (sample up to 50): channel=${reasonsCounts.channel}, date=${reasonsCounts.date}, unknown=${reasonsCounts.unknown}`
      );
      extraDetailsErrors.push(
        `Extra Slack messages (showing up to 50) with mismatch reasons:\n${lines.join('\n')}`
      );
    }

    errors.push(
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
    console.info('--- Slack coverage v2 test end');
  });

  test('Slack external_id coverage v2 config based (neo4j)', async ({ request }) => {
    console.info('--- Slack coverage v2 (neo4j) test start');
    console.info('Action: load Slack instance settings and compare filtered Slack messages to Neo4j DataItem.externalId.');
    loadEnvOnce();

    const slackRepository = new SlackRepository();
    const neo4jDataItemRepository = new Neo4jDataItemRepository();
    const validator = new SlackExternalIdValidator();

    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const errors: string[] = [];
    const workspaceId = 'T08EH9GDV';

    const slackSettingsResult = await adminInstancesRepository.getSlackSettingsForWorkspace(workspaceId);
    errors.push(...slackSettingsResult.errors);

    const workspaceSettings = (slackSettingsResult.settings?.workspace as Record<string, unknown> | undefined) ?? {};
    const channelIds = Array.isArray(workspaceSettings.channelIds)
      ? workspaceSettings.channelIds.filter((id) => typeof id === 'string') as string[]
      : [];
    const includeThreads = Boolean(workspaceSettings.includeThreads);
    const backfillDaysRaw = workspaceSettings.backfillDays;
    const backfillDays = typeof backfillDaysRaw === 'number' ? backfillDaysRaw : Number(backfillDaysRaw);
    const hasBackfillDays = Number.isFinite(backfillDays) && backfillDays > 0;

    console.info(`Using Slack settings from instance id=${slackSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`workspaceId: ${workspaceId}`);
    console.info(`channelIds: ${channelIds.length > 0 ? channelIds.join(', ') : '(none)'}`);
    console.info(`includeThreads=${includeThreads}`);
    console.info(`backfillDays: ${hasBackfillDays ? backfillDays : '(none)'}`);

    const slackResults = await slackRepository.getMessagesForChannels(channelIds, {
      includeThreads
    });

    const slackMessages = slackResults.flatMap((result) => result.messages.map((msg) => ({
      ...msg,
      channelId: result.channelId
    })));
    const slackErrors = slackResults.flatMap((result) =>
      result.errors.map((err) => `[channel ${result.channelId}] ${err}`)
    );
    errors.push(...slackErrors);

    console.info(`Slack messages fetched: ${slackMessages.length}`);

    const neo4jRows = await neo4jDataItemRepository.getBySourceAndAccount('slack', workspaceId);
    console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);

    const rawExternalIds = neo4jRows.map((row) => row.externalId);
    const neo4jExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const neo4jSet = new Set(neo4jExternalIdResult.externalIds);

    const cutoffMs =
      hasBackfillDays ? Date.now() - Math.floor(backfillDays) * 24 * 60 * 60 * 1000 : null;
    const cutoffIso = cutoffMs ? new Date(cutoffMs).toISOString().slice(0, 10) : null;

    const expectedExternalIds: string[] = [];
    const messageDetailsByExternalId: Record<string, string> = {};
    const clientMsgIdMap = new Map<string, { channelId: string; ts: string }>();

    for (const msg of slackMessages) {
      if (msg.subtype === 'channel_join') {
        continue;
      }
      const threadTs = msg.threadTs || msg.ts;
      const messageMs = Number(threadTs) * 1000;
      if (cutoffMs !== null && (!Number.isFinite(messageMs) || messageMs < cutoffMs)) {
        continue;
      }

      const isBot = Boolean(msg.botId);
      let externalId: string | null = null;

      if (isBot) {
        externalId = `${msg.channelId}-${threadTs}`;
      } else if (msg.clientMsgId && msg.clientMsgId.trim() !== '') {
        externalId = msg.clientMsgId;
      } else {
        errors.push(`Slack message ts=${msg.ts} is missing client_msg_id for non-bot message.`);
      }

      if (!externalId) {
        continue;
      }

      expectedExternalIds.push(externalId);
      if (!isBot && msg.clientMsgId) {
        clientMsgIdMap.set(msg.clientMsgId, { channelId: msg.channelId, ts: msg.ts });
      }

      const cleanText = msg.text.replace(/\s+/g, ' ').trim();
      const textPreview = cleanText.length > 120 ? `${cleanText.slice(0, 117)}...` : cleanText;
      const user = msg.user ?? msg.username ?? msg.botId ?? '(unknown user)';
      const subtype = msg.subtype ? ` (${msg.subtype})` : '';
      const dateText = new Date(messageMs).toISOString().slice(0, 10);
      messageDetailsByExternalId[externalId] = `- ${user}${subtype} | channel=${msg.channelId} | ${dateText} | ${textPreview}`;
    }

    const expectedUnique = [...new Set(expectedExternalIds)];
    console.info(`Expected Slack external_id count (after filters): ${expectedUnique.length}`);

    const coverageResult = validator.validateSlackIdsPresentInDb(
      expectedUnique,
      neo4jExternalIdResult.externalIds
    );

    const missingIds = expectedUnique.filter((id) => !neo4jSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      console.info(`Missing Slack messages in Neo4j: ${missingIds.length}`);
      const preview = missingIds.slice(0, 10);
      const lines = preview.map((id) => messageDetailsByExternalId[id] ?? `- ${id}`);
      missingDetailsErrors.push(
        `Missing Slack external_id(s) in Neo4j (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const expectedSet = new Set(expectedUnique);
    const channelJoinPattern = /^[A-Z0-9]+-channel_join-\d+(\.\d+)?$/;
    const ignoredChannelJoin = neo4jExternalIdResult.externalIds.filter((id) => channelJoinPattern.test(id));
    const extraIds = neo4jExternalIdResult.externalIds.filter(
      (id) => !expectedSet.has(id) && !channelJoinPattern.test(id)
    );
    const extraDetailsErrors: string[] = [];

    if (ignoredChannelJoin.length > 0) {
      console.info(`Ignoring Slack channel_join system messages in Neo4j: ${ignoredChannelJoin.length}`);
      const preview = ignoredChannelJoin.slice(0, 10);
      console.info(`Ignored channel_join examples (up to 10): ${preview.join(', ')}`);
    }

    if (extraIds.length > 0) {
      console.info(`Extra Slack messages in Neo4j (not in filtered Slack API results): ${extraIds.length}`);
      const sampleIds = extraIds.slice(0, 50);
      const reasonsCounts = { channel: 0, date: 0, unknown: 0 };

      const lines = sampleIds.map((id) => {
        const isBot = id.includes('-');
        const parts = id.split('-');
        const channelJoin = isBot && parts[1] === 'channel_join';

        let channelFromId: string | null = null;
        let messageTs: string | null = null;

        if (isBot) {
          channelFromId = parts[0] ?? null;
          messageTs = channelJoin ? parts[2] ?? null : parts.slice(1).join('-');
        } else {
          const mapped = clientMsgIdMap.get(id);
          channelFromId = mapped?.channelId ?? null;
          messageTs = mapped?.ts ?? null;
        }

        const messageMs = messageTs ? Number(messageTs) * 1000 : null;

        let reason = 'unknown';
        if (channelJoin) {
          reason = 'channel_join';
        } else if (cutoffMs !== null) {
          if (messageMs !== null && Number.isFinite(messageMs) && messageMs < cutoffMs) {
            reason = 'date';
          } else if (messageMs === null || !Number.isFinite(messageMs)) {
            reason = 'date';
          }
        } else if (channelFromId && channelIds.length > 0 && !channelIds.includes(channelFromId)) {
          reason = 'channel';
        }

        if (reason === 'date') reasonsCounts.date += 1;
        else if (reason === 'channel') reasonsCounts.channel += 1;
        else reasonsCounts.unknown += 1;

        const dateText = messageMs ? new Date(messageMs).toISOString().slice(0, 10) : 'unknown date';
        const cutoffText = cutoffIso ? ` (cutoff ${cutoffIso})` : '';
        return `- ${id} | date=${dateText}${cutoffText} | reason=${reason}`;
      });

      console.info(
        `Extra Slack mismatch reasons (sample up to 50): channel=${reasonsCounts.channel}, date=${reasonsCounts.date}, unknown=${reasonsCounts.unknown}`
      );
      extraDetailsErrors.push(
        `Extra Slack messages in Neo4j (showing up to 50) with mismatch reasons:\n${lines.join('\n')}`
      );
    }

    errors.push(
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
    console.info('--- Slack coverage v2 (neo4j) test end');
  });

  test(
    'Slack duplicates',
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

  test(
    'Slack duplicates (neo4j)',
    { tag: ['@check-duplicates', '@neo4j'] },
    async () => {
      console.info('--- Slack duplicates (neo4j) test start');
      console.info('Action: load Slack DataItem rows from Neo4j and check for duplicate externalId.');
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const workspaceId = 'T08EH9GDV';

      const duplicates = await neo4jDataItemRepository.getDuplicateExternalIdsBySourceAndAccount(
        'slack',
        workspaceId
      );
      console.info(`Neo4j duplicate externalIds found: ${duplicates.length}`);

      if (duplicates.length > 0) {
        console.info(`Duplicate Slack messages in Neo4j (${duplicates.length}):`);
        const lines = duplicates.map((row) => `${row.externalId} (count=${row.count})`);
        console.info(lines.join('\n'));
      }

      expect(duplicates.length, 'Duplicate Slack messages found in Neo4j').toBe(0);
      console.info('--- Slack duplicates (neo4j) test end');
    }
  );

  // Checks that as message time increases, created_utc does not decrease; logs Slack text for mismatches.
  test(
    'Slack order by created_utc',
    { tag: ['@order-test'] },
    async () => {
      console.info('--- Slack ingestion order test start');
      console.info('Action: validate created_utc increases while id decreases on DB sample.');
      loadEnvOnce();

      const rawItemRepository = new RawItemRepository();
      const validator = new SlackExternalIdValidator();

      const minSamples = 5;

      const dbRows = await rawItemRepository.getBySource('slack');
      console.info(`DB raw_item rows fetched: ${dbRows.length}`);

      const dbOrderResult = validator.validateDbRowsForCreatedUtcAndId(dbRows);
      const orderResult = validator.validateCreatedUtcIdOrder(dbOrderResult.items, minSamples);
      const errors: string[] = [...dbOrderResult.result.errors, ...orderResult.errors];

      if (errors.length > 0) {
        console.info(`Validation errors: ${errors.length}`);
        console.info(errors.join('\n'));
      }
      expect(errors, errors.join('\n')).toHaveLength(0);
      console.info('--- Slack ingestion order test end');
    }
  );

  // Checks that as createdAtUtc increases, rawVersionId decreases (adjacent-pair order check on Neo4j sample).
  test(
    'Slack order by createdAtUtc (neo4j)',
    { tag: ['@order-test', '@neo4j'] },
    async () => {
      console.info('--- Slack ingestion order (neo4j) test start');
      console.info('Action: validate createdAtUtc increases while rawVersionId decreases on Neo4j sample.');

      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const validator = new SlackExternalIdValidator();
      const workspaceId = 'T08EH9GDV';
      const minSamples = 5;

      const neo4jRows = await neo4jDataItemRepository.getBySourceAndAccount('slack', workspaceId);
      console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);

      const neo4jOrderResult = validator.validateNeo4jRowsForCreatedAtAndRawVersion(neo4jRows);
      const orderResult = validator.validateCreatedAtRawVersionOrder(neo4jOrderResult.items, minSamples);
      const errors: string[] = [...neo4jOrderResult.result.errors, ...orderResult.errors];

      if (errors.length > 0) {
        console.info(`Validation errors: ${errors.length}`);
        console.info(errors.join('\n'));
      }
      expect(errors, errors.join('\n')).toHaveLength(0);
      console.info('--- Slack ingestion order (neo4j) test end');
    }
  );

  test(
    'Catch new Slack message',
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

  test(
    'Catch new Slack message (neo4j)',
    { tag: ['@slack', '@dynamic', '@new-object-load', '@neo4j'] },
    async () => {
      console.info('--- Slack dynamic ingestion (neo4j) test start');
      console.info('Action: send a Slack message and poll Neo4j DataItem by externalId.');

      const slackRepository = new SlackRepository();
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const workspaceId = 'T08EH9GDV';

      loadEnvOnce();
      const channelId = process.env.SLACK_TEST_CHANNEL_ID ?? '';
      expect(channelId, 'SLACK_TEST_CHANNEL_ID is required.').not.toBe('');

      const beforeCount = await neo4jDataItemRepository.getCountBySourceAndAccount('slack', workspaceId);
      const beforeLatestCreatedAt = await neo4jDataItemRepository.getLatestCreatedAtBySourceAndAccount('slack', workspaceId);
      console.info(`Neo4j DataItem count before send: ${beforeCount}`);
      console.info(`Neo4j latest createdAtUtc before send: ${beforeLatestCreatedAt ?? 'null'}`);

      const timestamp = new Date().toISOString();
      const text = `PW-SLACK-INGESTION-NEO4J ${timestamp} (fixed body)`;

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
      const expectedExternalId = `${channelId}-${messageTs}`;
      console.info(`Expected Neo4j externalId: ${expectedExternalId}`);

      try {
        const pollResult = await neo4jDataItemRepository.pollBySourceAccountAndExternalId(
          'slack',
          workspaceId,
          expectedExternalId
        );
        const matchedRows = pollResult.rows;
        expect(matchedRows.length, 'No Neo4j DataItem row found for sent Slack message.').toBeGreaterThan(0);

        const latestRow = matchedRows[0];
        expect(latestRow.externalId, 'Neo4j DataItem externalId mismatch.').toBe(expectedExternalId);

        const afterCount = await neo4jDataItemRepository.getCountBySourceAndAccount('slack', workspaceId);
        console.info(`Neo4j DataItem count after poll: ${afterCount}`);
        expect(afterCount, 'Neo4j DataItem count should not decrease after ingestion.').toBeGreaterThanOrEqual(beforeCount);

        console.info('--- Slack dynamic ingestion (neo4j) test end');
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
