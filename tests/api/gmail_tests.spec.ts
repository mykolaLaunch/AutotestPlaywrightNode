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
    const coverageResult = validator.validateGmailIdsPresentInDb(
      gmailResult.ids,
      dbExternalIdResult.externalIds
    );

    const errors = [
      ...gmailResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors
    ];

    expect(errors, errors.join('\n')).toHaveLength(0);
  });
});
