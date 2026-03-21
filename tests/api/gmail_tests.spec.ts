import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import {GmailRepository} from "../../src/testing/repositories/GmailRepository";
import { GmailExternalIdValidator } from '../../src/testing/validators/GmailExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';

test.describe('Gmail tests', { tag: ['@gmail', '@regression'] }, () => {
  test('Gmail external_id coverage for mykola@launchnyc.io', async () => {
    console.info('--- Gmail coverage test start');
    console.info('Action: fetch Gmail message ids and compare to raw_item external_id.');
    const gmailRepository = new GmailRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GmailExternalIdValidator();

    const gmailResult = await gmailRepository.getAllMessageIds('me');
    console.info(`Gmail message ids fetched: ${gmailResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('gmail', 'mykola@launchnyc.io');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const coverageResult = validator.validateGmailIdsPresentInDb(
      gmailResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = gmailResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const detailsResult = await gmailRepository.getMessageDetails('me', missingIds, 10);
      missingDetailsErrors.push(...detailsResult.errors);

      if (detailsResult.details.length > 0) {
        const lines = detailsResult.details.map((detail) => {
          const folderLabels = new Set(['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'IMPORTANT', 'STARRED']);
          const categoryPrefix = 'CATEGORY_';

          const folders = detail.labelNames.filter((label) => folderLabels.has(label));
          const categories = detail.labelNames.filter((label) => label.startsWith(categoryPrefix));

          const folderText = folders.length > 0 ? folders.join(', ') : '(no folder)';
          const categoryText = categories.length > 0 ? categories.join(', ') : '(no category)';

          return `- folder=${folderText} | category=${categoryText} | ${detail.date} | ${detail.subject}`;
        });
        missingDetailsErrors.push(
          `Missing Gmail messages (showing up to 10):\n${lines.join('\n')}`
        );
      }
    }

    const errors = [
      ...gmailResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Gmail coverage test end');
  });

  test(
    'Gmail duplicates test for mykola@launchnyc.io',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Gmail duplicates test start');
    console.info('Action: load Gmail raw_item rows and check for duplicate external_id.');
    const rawItemRepository = new RawItemRepository();

    const dbRows = await rawItemRepository.getBySourceAndAccount('gmail', 'mykola@launchnyc.io');
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
      console.info(`Duplicate Gmail messages in DB (${duplicates.length}):`);
      console.info(duplicates.join('\n'));
    }

    expect(duplicates.length, 'Duplicate Gmail messages found in DB').toBe(0);
    console.info('--- Gmail duplicates test end');
    }
  );

  // Checks that as created_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test(
    'Gmail ingestion order by created_utc vs id for mykola@launchnyc.io',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Gmail ingestion order test start');
    console.info('Action: validate created_utc increases with id on DB sample.');
    const rawItemRepository = new RawItemRepository();
    const validator = new GmailExternalIdValidator();

    const sampleLimit = 1000;
    const minSamples = 5;

    const dbRows = await rawItemRepository.getBySourceAndAccountLimited(
      'gmail',
      'mykola@launchnyc.io',
      sampleLimit
    );
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const dbOrderResult = validator.validateDbRowsForCreatedUtcAndId(dbRows);
    const orderResult = validator.validateCreatedUtcIdOrder(dbOrderResult.items, minSamples);

    const errors = [
      ...dbOrderResult.result.errors,
      ...orderResult.errors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Gmail ingestion order test end');
    }
  );

  test(
    'Send Gmail message and verify raw_item ingestion by external_id',
    { tag: ['@gmail', '@dynamic', '@new-object-load'] },
    async () => {
      console.info('--- Gmail dynamic ingestion test start');
      console.info('Action: send a Gmail message and poll raw_item by external_id.');
      loadEnvOnce();
      const gmailRepository = new GmailRepository();
      const rawItemRepository = new RawItemRepository();

      const fromAddress = process.env.GMAIL_TEST_ADDRESS ?? process.env.GMAIL_TEST_FROM ?? '';
      const toAddress = process.env.GMAIL_TEST_TO ?? fromAddress;

      expect(fromAddress, 'GMAIL_TEST_ADDRESS (or GMAIL_TEST_FROM) is required.').not.toBe('');
      expect(toAddress, 'GMAIL_TEST_TO or GMAIL_TEST_ADDRESS is required.').not.toBe('');

      const beforeLatestId = await rawItemRepository.getLatestId();
      console.info(`Latest raw_item id before send: ${beforeLatestId ?? 'null'}`);
      test.info().attach('raw_items_before', {
        body: JSON.stringify({ latestId: beforeLatestId }, null, 2),
        contentType: 'application/json'
      });

      const timestamp = new Date().toISOString();
      const subject = `PW-GMAIL-INGESTION ${timestamp}`;
      const body = 'Playwright Gmail ingestion test content (fixed body).';

      let messageId: string | null = null;

      try {
        const sendResult = await gmailRepository.sendMessage('me', {
          from: fromAddress,
          to: toAddress,
          subject,
          body
        });

      test.info().attach('gmail_send_result', {
        body: JSON.stringify(sendResult, null, 2),
        contentType: 'application/json'
      });

        expect(sendResult.errors, sendResult.errors.join('\n')).toHaveLength(0);
        expect(sendResult.id, 'Gmail send did not return a message id.').toBeTruthy();

        messageId = sendResult.id as string;
        console.info(`Sent Gmail message id: ${messageId}`);

        const detailsResult = await gmailRepository.getMessageDetails('me', [messageId], 1);
        test.info().attach('gmail_message_details', {
          body: JSON.stringify(detailsResult, null, 2),
          contentType: 'application/json'
        });

        expect(detailsResult.errors, detailsResult.errors.join('\n')).toHaveLength(0);
        const messageDetails = detailsResult.details[0];
        expect(messageDetails, 'Gmail message details not found for sent message.').toBeTruthy();
        if (messageDetails) {
          console.info(`Gmail message subject: ${messageDetails.subject}`);
          console.info(`Gmail message date: ${messageDetails.date}`);
        }

        const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
        let matchedRows = [];

        const waitMs = 3000;
        const maxAttempts = 40;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const rows = await rawItemRepository.getBySourceAndExternalId('gmail', messageId);
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

        test.info().attach('raw_items_poll_attempts', {
          body: JSON.stringify(attemptsLog, null, 2),
          contentType: 'application/json'
        });

        const latestRow = matchedRows[0] as { id?: number; external_id?: string };
        test.info().attach('raw_items_match', {
          body: JSON.stringify(latestRow ?? null, null, 2),
          contentType: 'application/json'
        });

        expect(matchedRows.length, 'No raw_item row found for sent Gmail message.').toBeGreaterThan(0);
        expect(latestRow.external_id, 'raw_item external_id mismatch.').toBe(messageId);

        if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
          expect(latestRow.id, 'raw_item id should be greater than pre-send latest id.').toBeGreaterThan(beforeLatestId);
        }
        console.info('--- Gmail dynamic ingestion test end');
      } finally {
        if (messageId) {
          const deleteResult = await gmailRepository.deleteMessage('me', messageId);
          if (deleteResult.errors.length > 0) {
            console.info(`Gmail cleanup errors: ${deleteResult.errors.join('\n')}`);
          } else {
            console.info('Gmail cleanup: message deleted.');
          }
        }
      }
    }
  );
});
