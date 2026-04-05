import { test, expect } from '../testLogger';
import { GoogleDriveRepository } from '../../src/testing/repositories/GoogleDriveRepository';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { GoogleDriveExternalIdValidator } from '../../src/testing/validators/GoogleDriveExternalIdValidator';
import { loadEnvOnce } from '../../src/testing/utils/envLoader';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';

test.describe('Google Drive tests', { tag: ['@google-drive', '@regression'] }, () => {
  test('Google Drive coverage without config-based', async () => {
    console.info('--- Google Drive coverage test start');
    console.info('Action: fetch Drive file ids and compare to raw_item external_id.');
    const driveRepository = new GoogleDriveRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const driveResult = await driveRepository.getAllFileIds('me');
    console.info(`Drive file ids fetched: ${driveResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-drive', 'mykola@launchnyc.io');
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
    const missingLookupErrors: string[] = [];

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
        const owners = detail.owners.length > 0 ? detail.owners.join(', ') : '(no owners)';
        const driveId = detail.driveId ?? '(no driveId)';
        return `- ${folderName} | ${detail.modifiedDate} | ${detail.name} | ${detail.mimeType} | ${owners} | ${driveId}`;
      });

      missingDetailsErrors.push(
        `Missing Google Drive files (showing up to 10):\n${lines.join('\n')}`
      );

      console.info('Drive lookup for missing ids (first 10):');
      const lookupResult = await driveRepository.getFileDetailsByIds(preview, 'me');
      if (lookupResult.errors.length > 0) {
        missingLookupErrors.push(...lookupResult.errors);
      }
      const lookupLines = preview.map((id) => {
        const detail = lookupResult.detailsById[id];
        if (!detail) {
          return `- ${id} | NOT FOUND`;
        }
        const owners = detail.owners.length > 0 ? detail.owners.join(', ') : '(no owners)';
        const parents = detail.parentIds.length > 0 ? detail.parentIds.join(', ') : '(no parents)';
        const driveId = detail.driveId ?? '(no driveId)';
        return `- ${id} | ${detail.modifiedDate} | ${detail.name} | ${detail.mimeType} | owners=${owners} | parents=${parents} | driveId=${driveId}`;
      });
      console.info(lookupLines.join('\n'));
    }

    const errors = [
      ...driveResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors,
      ...missingLookupErrors
    ];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Drive coverage test end');
  });

  test('Google Drive config-based external_id coverage for mykola@launchnyc.io', async ({ request }) => {
    console.info('--- Google Drive coverage (config-based) test start');
    console.info('Action: load Drive instance settings and compare filtered Drive ids to raw_item external_id.');
    loadEnvOnce();

    const driveRepository = new GoogleDriveRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
    const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);

    const errors: string[] = [];
    const targetEmail = 'mykola@launchnyc.io';
    const driveSettingsResult = await adminInstancesRepository.getGoogleDriveSettingsForUserEmail(targetEmail);
    errors.push(...driveSettingsResult.errors);

    const settings = (driveSettingsResult.settings ?? {}) as Record<string, unknown>;
    const folderIds = Array.isArray(settings.folderIds)
      ? settings.folderIds.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
      : [];
    const includeMimeTypes = Array.isArray(settings.includeMimeTypes)
      ? settings.includeMimeTypes.filter((type): type is string => typeof type === 'string' && type.trim() !== '')
      : [];
    const excludeMimeTypes = Array.isArray(settings.excludeMimeTypes)
      ? settings.excludeMimeTypes.filter((type): type is string => typeof type === 'string' && type.trim() !== '')
      : [];
    const folderPaths = settings.folderPaths as Record<string, unknown> | undefined;

    console.info(`Using Google Drive settings from instance id=${driveSettingsResult.instance?.id ?? 'unknown'}`);
    console.info(`folderIds: ${folderIds.length > 0 ? folderIds.join(', ') : '(none)'}`);
    console.info(`includeMimeTypes: ${includeMimeTypes.length > 0 ? includeMimeTypes.join(', ') : '(none)'}`);
    console.info(`excludeMimeTypes: ${excludeMimeTypes.length > 0 ? excludeMimeTypes.join(', ') : '(none)'}`);

    if (folderPaths && folderIds.length > 0) {
      const folderLines = folderIds.map((id) => {
        const label = typeof folderPaths[id] === 'string' ? folderPaths[id] : '(no path)';
        return `- ${id} => ${label}`;
      });
      console.info(`folderPaths:\n${folderLines.join('\n')}`);
    }

    if (folderIds.length === 0) {
      errors.push('Google Drive instance settings did not include folderIds.');
    }

    const driveResult = await driveRepository.getFileIdsByFolderIds(
      folderIds,
      'me',
      { includeMimeTypes, excludeMimeTypes }
    );
    console.info(`Filtered Drive file ids fetched: ${driveResult.ids.length}`);

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-drive', targetEmail);
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);
    const dbSet = new Set(dbExternalIdResult.externalIds);
    const driveSet = new Set(driveResult.ids);
    const coverageResult = validator.validateFileIdsPresentInDb(
      driveResult.ids,
      dbExternalIdResult.externalIds
    );

    const missingIds = driveResult.ids.filter((id) => !dbSet.has(id));
    const missingDetailsErrors: string[] = [];
    const missingLookupErrors: string[] = [];

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
        const owners = detail.owners.length > 0 ? detail.owners.join(', ') : '(no owners)';
        const driveId = detail.driveId ?? '(no driveId)';
        return `- ${folderName} | ${detail.modifiedDate} | ${detail.name} | ${detail.mimeType} | ${owners} | ${driveId}`;
      });

      missingDetailsErrors.push(
        `Missing Google Drive files (showing up to 10):\n${lines.join('\n')}`
      );

      console.info('Drive lookup for missing ids (first 10):');
      const lookupResult = await driveRepository.getFileDetailsByIds(preview, 'me');
      if (lookupResult.errors.length > 0) {
        missingLookupErrors.push(...lookupResult.errors);
      }
      const lookupLines = preview.map((id) => {
        const detail = lookupResult.detailsById[id];
        if (!detail) {
          return `- ${id} | NOT FOUND`;
        }
        const owners = detail.owners.length > 0 ? detail.owners.join(', ') : '(no owners)';
        const parents = detail.parentIds.length > 0 ? detail.parentIds.join(', ') : '(no parents)';
        const driveId = detail.driveId ?? '(no driveId)';
        return `- ${id} | ${detail.modifiedDate} | ${detail.name} | ${detail.mimeType} | owners=${owners} | parents=${parents} | driveId=${driveId}`;
      });
      console.info(lookupLines.join('\n'));
    }

    const extraIds = dbExternalIdResult.externalIds.filter((id) => !driveSet.has(id));
    const extraDetailsErrors: string[] = [];

    if (extraIds.length > 0) {
      console.info(`Extra Drive files in DB (not in configured Drive results): ${extraIds.length}`);
      const sampleIds = extraIds.slice(0, 50);
      const lookupResult = await driveRepository.getFileDetailsByIds(sampleIds, 'me');
      extraDetailsErrors.push(...lookupResult.errors);

      const parentIds = new Set<string>();
      for (const id of sampleIds) {
        const detail = lookupResult.detailsById[id];
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
        extraDetailsErrors.push(
          `Failed to resolve Google Drive parent folder names for extra ids: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      const lines = sampleIds.map((id) => {
        const detail = lookupResult.detailsById[id];
        if (!detail) {
          return `- ${id} | NOT FOUND`;
        }
        const folderName =
          detail.parentIds.length > 0
            ? detail.parentIds
                .map((parentId) => parentNames.get(parentId) ?? parentId)
                .join(', ')
            : '(no folder)';
        const owners = detail.owners.length > 0 ? detail.owners.join(', ') : '(no owners)';
        const driveId = detail.driveId ?? '(no driveId)';
        return `- ${id} | ${folderName} | ${detail.modifiedDate} | ${detail.name} | ${detail.mimeType} | ${owners} | ${driveId}`;
      });

      extraDetailsErrors.push(
        `Extra Google Drive files (showing up to 50):\n${lines.join('\n')}`
      );
    }

    errors.push(
      ...driveResult.errors,
      ...dbExternalIdResult.result.errors,
      ...coverageResult.errors,
      ...missingDetailsErrors,
      ...missingLookupErrors,
      ...extraDetailsErrors
    );

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }
    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Google Drive coverage (config-based) test end');
  });

  test(
    'Google Drive duplicates',
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
    'Google Drive order by modified_time',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Google Drive ingestion order test start');
    console.info('Action: validate Drive modifiedTime increases while DB id decreases.');
    const rawItemRepository = new RawItemRepository();
    const driveRepository = new GoogleDriveRepository();
    const validator = new GoogleDriveExternalIdValidator();

    const minSamples = 3;

    const dbRows = await rawItemRepository.getBySourceAndAccount('google-drive', 'mykola@launchnyc.io');
    console.info(`DB raw_item rows fetched: ${dbRows.length}`);

    const rawExternalIds = dbRows.map((row) => (row as { external_id?: unknown }).external_id);
    const dbExternalIdResult = validator.validateDbExternalIds(rawExternalIds);

    const driveDetailsResult = await driveRepository.getFileDetailsByIds(
      dbExternalIdResult.externalIds,
      'me'
    );

    const driveOrderItemsResult = validator.buildDriveModifiedOrderItems(
      dbRows,
      driveDetailsResult.detailsById
    );
    const orderResult = validator.validateDriveModifiedTimeIdOrder(
      driveOrderItemsResult.items,
      minSamples
    );

    if (driveOrderItemsResult.items.length > 0) {
      const sorted = driveOrderItemsResult.items
        .slice()
        .sort((a, b) => a.modifiedTimeMs - b.modifiedTimeMs || a.id - b.id);
      const mismatchIds = new Set<string>();

      for (let i = 0; i < sorted.length - 1; i += 1) {
        const current = sorted[i];
        const next = sorted[i + 1];
        if (current.modifiedTimeMs < next.modifiedTimeMs && current.id < next.id) {
          mismatchIds.add(current.externalId);
          mismatchIds.add(next.externalId);
        }
      }

      if (mismatchIds.size > 0) {
        const mismatchList = [...mismatchIds];
        console.info(`Order mismatch files detected: ${mismatchList.length}`);

        const mismatchLookup = await driveRepository.getFileDetailsByIds(mismatchList, 'me');
        if (mismatchLookup.errors.length > 0) {
          console.info(`Drive lookup errors for mismatch files:\n${mismatchLookup.errors.join('\n')}`);
        }

        const lines = mismatchList.map((id) => {
          const detail = mismatchLookup.detailsById[id] ?? driveDetailsResult.detailsById[id];
          if (!detail) {
            return `- id=${id} | name=(not found) | modified=unknown`;
          }
          const name = detail.name?.trim() ? detail.name : '(unnamed)';
          const modified = detail.modifiedDate?.trim() ? detail.modifiedDate : 'unknown date';
          return `- id=${id} | name=${name} | modified=${modified}`;
        });

        console.info('Problematic files (order mismatch):');
        console.info(lines.join('\n'));
      }
    }

    const errors = [
      ...dbExternalIdResult.result.errors,
      ...driveDetailsResult.errors,
      ...driveOrderItemsResult.result.errors,
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
    'Catch Google Drive new file',
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
        expect(matchedRows.length, 'No raw_item row found for created Drive file. Wait time 2 minutes').toBeGreaterThan(0);

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
