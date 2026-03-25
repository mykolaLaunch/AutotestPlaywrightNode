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

  test(
    'Drive duplicates test for me',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Google Drive duplicates test start');
    console.info('Action: load Drive raw_item rows and check for duplicate external_id.');
    const rawItemRepository = new RawItemRepository();

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-drive', 'me');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const counts = new Map<string, number>();
    const duplicates: string[] = [];
    const invalidExternalIds: string[] = [];

    for (const row of dbRows) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        invalidExternalIds.push(String(externalId));
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

    if (invalidExternalIds.length > 0) {
      console.info(`Invalid Drive external_id values in DB (${invalidExternalIds.length}):`);
      console.info(invalidExternalIds.join('\n'));
    }

    if (duplicates.length > 0) {
      console.info(`Duplicate Drive files in DB (${duplicates.length}):`);
      console.info(duplicates.join('\n'));
    }

    const errors = [
      ...invalidExternalIds.map((value) => `Invalid external_id: ${value}`),
      ...duplicates.map((value) => `Duplicate external_id: ${value}`)
    ];

    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Drive duplicates test end');
    }
  );

  // Checks that as updated_utc increases, id decreases (adjacent-pair order check on DB sample).
  test(
    'Drive ingestion order by updated_utc vs id for me',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Google Drive ingestion order test start');
    console.info('Action: validate updated_utc increases while id decreases on DB sample.');
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const sampleLimit = 1000;
    const minSamples = 3;

    const dbRows = await rawItemRepository.getBySourceAndAccountLimited('google-drive', 'mykola@launchnyc.io', sampleLimit);
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

  test(
    'Send Drive file and verify raw_item ingestion by external_id',
    { tag: ['@google-drive', '@dynamic', '@new-object-load'] },
    async () => {
      console.info('--- Google Drive dynamic ingestion test start');
      console.info('Action: create a Drive file and poll raw_item by external_id.');

      const driveRepository = new GoogleDriveRepository();
      const rawItemRepository = new RawItemRepository();

      const beforeLatestId = await rawItemRepository.getLatestId();
      console.info(`Latest raw_item id before create: ${beforeLatestId ?? 'null'}`);

      const timestamp = new Date().toISOString();
      const fileName = `PW-DRIVE-INGESTION ${timestamp}.txt`;
      const content = 'Playwright Google Drive ingestion test content (fixed body).';

      let fileId: string | null = null;
      const createResult = await driveRepository.createTextFile(fileName, content);

      if (createResult.errors.length > 0) {
        console.info(createResult.errors.join('\n'));
      }

      expect(createResult.errors, createResult.errors.join('\n')).toHaveLength(0);
      expect(createResult.id, 'Drive create did not return a file id.').toBeTruthy();

      fileId = createResult.id as string;
      console.info(`Created Drive file id: ${fileId}`);

      const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
      let matchedRows: Array<Record<string, unknown>> = [];

      const waitMs = 3000;
      const maxAttempts = 40;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rows = await rawItemRepository.getBySourceAndExternalId('google-drive', fileId);
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
        expect(matchedRows.length, 'No raw_item row found for created Drive file.').toBeGreaterThan(0);

        const latestRow = matchedRows[0] as { id?: number; external_id?: string };
        expect(latestRow.external_id, 'raw_item external_id mismatch.').toBe(fileId);

        if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
          expect(latestRow.id, 'raw_item id should be greater than pre-create latest id.').toBeGreaterThan(beforeLatestId);
        }

        console.info('--- Google Drive dynamic ingestion test end');
      } finally {
        if (fileId) {
          const deleteResult = await driveRepository.deleteFile(fileId);
          if (deleteResult.errors.length > 0) {
            console.info(`Drive cleanup errors: ${deleteResult.errors.join('\n')}`);
          } else {
            console.info('Drive cleanup: file deleted.');
          }
        }
      }
    }
  );
});
