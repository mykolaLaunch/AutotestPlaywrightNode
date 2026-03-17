import { test, expect } from '@playwright/test';
import { GmailRepository } from '../../src/testing/repositories/GmailRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GmailExternalIdValidator } from '../../src/testing/validators/GmailExternalIdValidator';

test.describe('Gmail tests', () => {
  test('Gmail external_id coverage for mykola@launchnyc.io', async () => {
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

    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
