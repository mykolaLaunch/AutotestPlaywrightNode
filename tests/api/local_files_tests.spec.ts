import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { FileTreeRepository } from '../../src/repositories/FileTreeRepository';
import { FileSystemExternalIdValidator } from '../../src/testing/validators/FileSystemExternalIdValidator';
import fs from 'fs';
import path from 'path';

test.describe('Local files tests', { tag: ['@local-files', '@regression'] }, () => {
  test('File tree db completeness test', async () => {
    console.info('--- Local files test start');
    console.info('Action: load file-system raw items and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();
    const fileRawItems = await rawItemRepository.getBySource('file-system');
    console.info(`Raw items fetched: ${fileRawItems.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${Object.keys(fileSchema).length}`);
    console.info('Validation: every file from the tree should exist in DB.');

    const dbPaths = new Set<string>();
    for (const row of fileRawItems) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId === 'string' && externalId.trim() !== '') {
        dbPaths.add(externalId);
      }
    }

    const missingFiles = Object.keys(fileSchema).filter((filePath) => !dbPaths.has(filePath));
    if (missingFiles.length > 0) {
      console.info(`Missing files in DB (${missingFiles.length}):`);
      console.info(missingFiles.join('\n'));
    }

    expect(missingFiles.length, 'Some files are missing in DB').toBe(0);
    console.info('--- Local files test end');
  });

  test(
    'File tree db duplicates test',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Local files duplicates test start');
    console.info('Action: load file-system raw items and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();

    const fileRawItems = await rawItemRepository.getBySource('file-system');
    console.info(`Raw items fetched: ${fileRawItems.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${Object.keys(fileSchema).length}`);

    console.info('Validation: no duplicate external_id entries should exist in DB.');

    const duplicateCounts = new Map<string, number>();
    const duplicatePaths: string[] = [];
    for (const row of fileRawItems) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        continue;
      }
      const next = (duplicateCounts.get(externalId) ?? 0) + 1;
      duplicateCounts.set(externalId, next);
    }

    for (const [externalId, count] of duplicateCounts.entries()) {
      if (count > 1) {
        duplicatePaths.push(`${externalId} (count=${count})`);
      }
    }

    if (duplicatePaths.length > 0) {
      console.info(`Duplicate files in DB (${duplicatePaths.length}):`);
      console.info(duplicatePaths.join('\n'));
    }

    expect(duplicatePaths.length, 'Duplicate external_id entries found in DB').toBe(0);
    console.info('--- Local files duplicates test end');
    }
  );

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test(
    'Local files ingestion order by updated_utc vs id',
    { tag: ['@order-test'] },
    async () => {
    console.info('--- Local files ingestion order test start');
    console.info('Action: validate updated_utc increases with id on DB sample.');
    const rawItemRepository = new RawItemRepository();
    const validator = new FileSystemExternalIdValidator();

    const minSamples = 3;

    const dbRows = await rawItemRepository.getBySource('file-system');
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
    console.info('--- Local files ingestion order test end');
    }
  );

  test(
    'Create local file and verify raw_item ingestion by external_id',
    { tag: ['@local-files', '@dynamic', '@new-object-load'] },
    async () => {
      console.info('--- Local files dynamic ingestion test start');
      console.info('Action: create a new .txt file and poll raw_item by external_id.');

      const rawItemRepository = new RawItemRepository();

      const beforeLatestId = await rawItemRepository.getLatestId();
      console.info(`Latest raw_item id before create: ${beforeLatestId ?? 'null'}`);

      const rootDir = 'TestFilesDirectory';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `pw-local-file-${timestamp}.txt`;
      const filePath = path.resolve(rootDir, fileName);
      const content = 'Playwright local file ingestion test content (fixed body).';

      await fs.promises.writeFile(filePath, content, 'utf8');
      console.info(`Created file: ${filePath}`);

      const attemptsLog: Array<{ attempt: number; found: boolean; rowCount: number; at: string }> = [];
      let matchedRows: Array<Record<string, unknown>> = [];

      const waitMs = 3000;
      const maxAttempts = 40;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const rows = await rawItemRepository.getBySourceAndExternalId('file-system', filePath);
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

      expect(matchedRows.length, 'No raw_item row found for created local file.').toBeGreaterThan(0);

      const latestRow = matchedRows[0] as { id?: number; external_id?: string };
      expect(latestRow.external_id, 'raw_item external_id mismatch.').toBe(filePath);

      if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
        expect(latestRow.id, 'raw_item id should be greater than pre-create latest id.').toBeGreaterThan(beforeLatestId);
      }

      console.info('--- Local files dynamic ingestion test end');
    }
  );
});
