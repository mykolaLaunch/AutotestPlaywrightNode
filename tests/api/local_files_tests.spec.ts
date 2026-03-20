import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { FileTreeRepository } from '../../src/repositories/FileTreeRepository';
import { FileSystemValidator } from '../../src/db/validators/FileSystemValidator';
import fs from 'fs';
import path from 'path';

test.describe('Local files tests', { tag: ['@local-files', '@regression'] }, () => {
  test('File tree db source test', async () => {
    console.info('--- Local files test start');
    console.info('Action: load file-system raw items and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();
    const fileValidator = new FileSystemValidator();
    const fileRawItems = await rawItemRepository.getBySource('file-system');
    console.info(`Raw items fetched: ${fileRawItems.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${fileSchema.length}`);
    console.info('Validation: file-system raw items should match file tree schema.');
    const result = fileValidator.validate(fileRawItems, fileSchema);
    // const result = await fileValidator.validateDepthLoadOrder(fileRawItems, fileSchema);

    if (result.errors.length > 0) {
      console.info(`Validation errors: ${result.errors.length}`);
      console.info(result.errors.join('\n'));
    }
    expect(result.errors, 'File system validation should not have errors').toBe(0);
    console.info('--- Local files test end');
  });

  test(
    'Create local file and verify raw_item ingestion by external_id',
    { tag: ['@local-files', '@dynamic'] },
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
      const maxAttempts = 10;

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
