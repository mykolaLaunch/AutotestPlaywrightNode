import { test, expect } from '../testLogger';
import { GoogleDriveRepository } from '../../src/testing/repositories/GoogleDriveRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GoogleDriveExternalIdValidator } from '../../src/testing/validators/GoogleDriveExternalIdValidator';

test.describe('Google Drive tests', { tag: ['@google-drive', '@regression'] }, () => {
  test('Drive external_id coverage for me', async () => {
    console.info('--- Google Drive coverage test start');
    console.info('Action: fetch Drive file ids and compare to raw_item external_id.');
    const driveRepository = new GoogleDriveRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const driveResult = await driveRepository.getAllFileIds('me');
    console.info(`Drive file ids fetched: ${driveResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-drive', 'me');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const coverageResult = validator.validateFileIdsPresentInDb(
      driveResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = driveResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];

    if (missingIds.length > 0) {
      const preview = missingIds.slice(0, 10);
      const parentIds = new Set<string>();

      for (const id of preview) {
        const detail = driveResult.fileDetailsById[id];
        if (detail?.parentIds?.length) {
          detail.parentIds.forEach((parentId) => parentIds.add(parentId));
        }
      }

      let parentNames = new Map<string, string>();
      try {
        if (parentIds.size > 0) {
          parentNames = await driveRepository.resolveParentNames([...parentIds], 'me');
        }
      } catch (err) {
        missingDetailsErrors.push(
          `Failed to resolve Google Drive parent folder names: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      const lines = preview.map((id) => {
        const detail = driveResult.fileDetailsById[id];
        if (!detail) {
          return `- (unknown folder) | unknown date | (unknown file)`;
        }
        const folderName =
          detail.parentIds.length > 0
            ? detail.parentIds
                .map((parentId) => parentNames.get(parentId) ?? parentId)
                .join(', ')
            : '(no folder)';
        return `- ${folderName} | ${detail.modifiedDate} | ${detail.name}`;
      });

      missingDetailsErrors.push(
        `Missing Google Drive files (showing up to 10):\n${lines.join('\n')}`
      );
    }

    const errors = [
      ...driveResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Drive coverage test end');
  });

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test(
    'Drive ingestion order by updated_utc vs id for me',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Google Drive ingestion order test start');
    console.info('Action: validate updated_utc increases with id on DB sample.');
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const sampleLimit = 1000;
    const minSamples = 3;

    const dbRows = await rawItemRepository.getBySourceAndAccountLimited('google-drive', 'me', sampleLimit);
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
    console.info('--- Google Drive ingestion order test end');
    }
  );
});
