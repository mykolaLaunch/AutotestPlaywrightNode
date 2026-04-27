import { test, expect } from '../testLogger';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { FileTreeRepository } from '../../src/repositories/FileTreeRepository';
import { FileSystemExternalIdValidator } from '../../src/testing/validators/FileSystemExternalIdValidator';
import { FileSystemConnectorSettingsValidator } from '../../src/testing/validators/FileSystemConnectorSettingsValidator';
import { AdminConnectorsRepository } from '../../src/api/repositories/AdminConnectorsRepository';
import { AdminConnectorsValidator } from '../../src/testing/validators/AdminConnectorsValidator';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { Neo4jDataItemRepository } from '../../src/neo4j/Neo4jDataItemRepository';
import fs from 'fs';
import path from 'path';

test.describe('Local files tests', { tag: ['@local-files', '@regression'] }, () => {
  test('File coverage', async () => {
    console.info('--- Local files test start');
    console.info('Action: load file-system raw items and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new FileSystemExternalIdValidator();
    const fileRawItems = await rawItemRepository.getBySource('file-system');
    console.info(`Raw items fetched: ${fileRawItems.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${Object.keys(fileSchema).length}`);
    console.info('Validation: every file from the tree should exist in DB.');

    const externalIdValidation = validator.validateExternalIds(
      fileRawItems.map((row) => (row as { external_id?: unknown }).external_id),
      'DB'
    );
    const coverageValidation = validator.validatePathsPresentInStorage(
      Object.keys(fileSchema),
      externalIdValidation.externalIds,
      'DB'
    );
    const errors = [...externalIdValidation.result.errors, ...coverageValidation.errors];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }

    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Local files test end');
  });

  test('File coverage (neo4j)', async () => {
    console.info('--- Local files coverage (neo4j) test start');
    console.info('Action: load file-system Neo4j DataItems and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const neo4jDataItemRepository = new Neo4jDataItemRepository();
    const validator = new FileSystemExternalIdValidator();

    const neo4jRows = await neo4jDataItemRepository.getBySource('file-system');
    console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${Object.keys(fileSchema).length}`);
    console.info('Validation: every file from the tree should exist in Neo4j.');

    const externalIdValidation = validator.validateExternalIds(
      neo4jRows.map((row) => row.externalId),
      'Neo4j'
    );
    const coverageValidation = validator.validatePathsPresentInStorage(
      Object.keys(fileSchema),
      externalIdValidation.externalIds,
      'Neo4j'
    );
    const errors = [...externalIdValidation.result.errors, ...coverageValidation.errors];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }

    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Local files coverage (neo4j) test end');
  });

  test(
    'File tree db duplicates test',
    { tag: ['@check-duplicates'] },
    async () => {
    console.info('--- Local files duplicates test start');
    console.info('Action: load file-system raw items and file tree schema.');
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();
    const validator = new FileSystemExternalIdValidator();

    const fileRawItems = await rawItemRepository.getBySource('file-system');
    console.info(`Raw items fetched: ${fileRawItems.length}`);
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    console.info(`File tree nodes: ${Object.keys(fileSchema).length}`);

    console.info('Validation: no duplicate external_id entries should exist in DB.');

    const externalIdValidation = validator.validateExternalIds(
      fileRawItems.map((row) => (row as { external_id?: unknown }).external_id),
      'DB'
    );
    const duplicateValidation = validator.validateNoDuplicateExternalIds(externalIdValidation.externalIds, 'DB');
    const errors = [...externalIdValidation.result.errors, ...duplicateValidation.errors];

    if (errors.length > 0) {
      console.info(`Validation errors: ${errors.length}`);
      console.info(errors.join('\n'));
    }

    expect(errors, errors.join('\n')).toHaveLength(0);
    console.info('--- Local files duplicates test end');
    }
  );

  test(
    'File tree neo4j duplicates test',
    { tag: ['@check-duplicates', '@neo4j'] },
    async () => {
      console.info('--- Local files duplicates (neo4j) test start');
      console.info('Action: load file-system DataItems from Neo4j and check for duplicate externalId.');
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const validator = new FileSystemExternalIdValidator();

      const neo4jRows = await neo4jDataItemRepository.getBySource('file-system');
      console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);
      console.info('Validation: no duplicate externalId entries should exist in Neo4j.');

      const externalIdValidation = validator.validateExternalIds(
        neo4jRows.map((row) => row.externalId),
        'Neo4j'
      );
      const duplicateValidation = validator.validateNoDuplicateExternalIds(
        externalIdValidation.externalIds,
        'Neo4j'
      );
      const errors = [...externalIdValidation.result.errors, ...duplicateValidation.errors];

      if (errors.length > 0) {
        console.info(`Validation errors: ${errors.length}`);
        console.info(errors.join('\n'));
      }

      expect(errors, errors.join('\n')).toHaveLength(0);
      console.info('--- Local files duplicates (neo4j) test end');
    }
  );

  // Checks that as updated_utc increases, id does not decrease (adjacent-pair order check on DB sample).
  test(
    'Local files order by updated_utc',
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

  // Checks that as createdAtUtc increases, rawVersionId does not increase (adjacent-pair order check on Neo4j sample).
  test(
    'Local files order by createdAtUtc (neo4j)',
    { tag: ['@order-test', '@neo4j'] },
    async () => {
      console.info('--- Local files ingestion order (neo4j) test start');
      console.info('Action: validate createdAtUtc increases while rawVersionId decreases on Neo4j sample.');
      const neo4jDataItemRepository = new Neo4jDataItemRepository();
      const validator = new FileSystemExternalIdValidator();

      const minSamples = 3;

      const neo4jRows = await neo4jDataItemRepository.getBySource('file-system');
      console.info(`Neo4j DataItem rows fetched: ${neo4jRows.length}`);

      const neo4jOrderResult = validator.validateNeo4jRowsForCreatedAtAndRawVersion(neo4jRows);
      const orderResult = validator.validateCreatedAtRawVersionOrder(neo4jOrderResult.items, minSamples);

      const errors = [
        ...neo4jOrderResult.result.errors,
        ...orderResult.errors
      ];

      if (errors.length > 0) {
        console.info(`Validation errors: ${errors.length}`);
        console.info(errors.join('\n'));
      }
      expect(errors, errors.join('\n')).toHaveLength(0);
      console.info('--- Local files ingestion order (neo4j) test end');
    }
  );

  test(
    'New file',
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

      const pollResult = await rawItemRepository.pollBySourceAndExternalId('file-system', filePath);
      const matchedRows = pollResult.rows;

      expect(matchedRows.length, 'No raw_item row found for created local file.').toBeGreaterThan(0);

      const latestRow = matchedRows[0] as { id?: number; external_id?: string };
      expect(latestRow.external_id, 'raw_item external_id mismatch.').toBe(filePath);

      if (typeof latestRow.id === 'number' && typeof beforeLatestId === 'number') {
        expect(latestRow.id, 'raw_item id should be greater than pre-create latest id.').toBeGreaterThan(beforeLatestId);
      }

      console.info('--- Local files dynamic ingestion test end');
    }
  );

  test(
    'New file (neo4j)',
    { tag: ['@local-files', '@dynamic', '@new-object-load', '@neo4j'] },
    async () => {
      console.info('--- Local files dynamic ingestion (neo4j) test start');
      console.info('Action: create a new .txt file and poll Neo4j DataItem by externalId.');

      const neo4jDataItemRepository = new Neo4jDataItemRepository();

      const beforeCount = await neo4jDataItemRepository.getCountBySource('file-system');
      console.info(`Neo4j DataItem count before create: ${beforeCount}`);

      const rootDir = 'TestFilesDirectory';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `pw-local-file-neo4j-${timestamp}.txt`;
      const filePath = path.resolve(rootDir, fileName);
      const content = 'Playwright local file ingestion test content for Neo4j dynamic check.';

      await fs.promises.writeFile(filePath, content, 'utf8');
      console.info(`Created file: ${filePath}`);

      const pollResult = await neo4jDataItemRepository.pollBySourceAndExternalId('file-system', filePath);
      const matchedRows = pollResult.rows;
      expect(matchedRows.length, 'No Neo4j DataItem row found for created local file.').toBeGreaterThan(0);

      const latestRow = matchedRows[0];
      expect(latestRow.externalId, 'Neo4j DataItem externalId mismatch.').toBe(filePath);

      const afterCount = await neo4jDataItemRepository.getCountBySource('file-system');
      console.info(`Neo4j DataItem count after poll: ${afterCount}`);
      expect(afterCount, 'Neo4j DataItem count should not decrease after ingestion.').toBeGreaterThanOrEqual(beforeCount);

      console.info('--- Local files dynamic ingestion (neo4j) test end');
    }
  );

  test(
    'Folder rename ingestion after connector folder add',
    { tag: ['@local-files', '@dynamic', '@folder-rename'] },
    async ({ request }) => {
      console.info('--- Local files folder rename ingestion test start');
      const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5198';
      const rawItemRepository = new RawItemRepository();
      const adminConnectorsRepository = new AdminConnectorsRepository(request, apiBaseUrl);
      const adminConnectorsValidator = new AdminConnectorsValidator();
      const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);
      const settingsValidator = new FileSystemConnectorSettingsValidator();

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const scenarioRoot = path.resolve(`pw-rename-${timestamp}`);
      const folderA = path.join(scenarioRoot, 'folder-A');
      const folderB = path.join(scenarioRoot, 'folder-B');
      const file1 = path.join(folderA, 'file-1.txt');
      const file2 = path.join(folderB, 'file-2.txt');

      let instanceId: number | null = null;
      let originalSettingsJson: string | null = null;

      try {
        await fs.promises.mkdir(folderA, { recursive: true });
        await fs.promises.writeFile(file1, 'Local files rename scenario - first file.', 'utf8');
        console.info(`Created folder and file: ${folderA}, ${file1}`);

        const fileSystemInstanceResult = await adminInstancesRepository.getFileSystemInstance();
        expect(
          fileSystemInstanceResult.errors,
          fileSystemInstanceResult.errors.join('\n')
        ).toHaveLength(0);
        const fileSystemInstance = fileSystemInstanceResult.instance;
        expect(fileSystemInstance, 'No file-system connector instance found in /admin/instances').toBeTruthy();
        if (!fileSystemInstance) return;

        instanceId = Number(fileSystemInstance.id);
        originalSettingsJson = fileSystemInstance.settingsJson ?? null;
        const parseResult = settingsValidator.parseSettingsJson(originalSettingsJson);
        expect(parseResult.errors, parseResult.errors.join('\n')).toHaveLength(0);
        expect(parseResult.settings, 'Parsed file-system settings are null').toBeTruthy();
        if (!parseResult.settings) return;
        const addRootResult = settingsValidator.addRootPath(parseResult.settings, folderA);
        expect(addRootResult.result.errors, addRootResult.result.errors.join('\n')).toHaveLength(0);

        const updateBody = {
          displayName: fileSystemInstance.displayName,
          settingsJson: JSON.stringify(addRootResult.updatedSettings),
          enabled: fileSystemInstance.enabled,
          status: fileSystemInstance.status,
          error: fileSystemInstance.error
        };

        const updateResponse = await adminInstancesRepository.updateAdminInstanceRaw(instanceId, updateBody);
        const updateStatusResult = settingsValidator.validateUpdateStatus(updateResponse.status());
        expect(updateStatusResult.errors, updateStatusResult.errors.join('\n')).toHaveLength(0);
        console.info(
          `Updated file-system instance ${instanceId}; folder root ${
            addRootResult.changed ? 'added' : 'already exists'
          }: ${folderA}`
        );

        const firstRescanResponse = await adminConnectorsRepository.postRescanRaw();
        const firstRescanResult = adminConnectorsValidator.validateRescanStatus(firstRescanResponse.status());
        expect(firstRescanResult.errors, firstRescanResult.errors.join('\n')).toHaveLength(0);

        const ingestedFirstResult = await rawItemRepository.pollBySourceAndExternalId('file-system', file1);
        const ingestedFirst = ingestedFirstResult.rows;
        expect(ingestedFirst.length, 'file-1.txt was not ingested after folder add').toBeGreaterThan(0);

        await fs.promises.rename(folderA, folderB);
        await fs.promises.writeFile(file2, 'Local files rename scenario - second file after rename.', 'utf8');
        console.info(`Renamed folder and created second file: ${folderB}, ${file2}`);

        const rescanResponse = await adminConnectorsRepository.postRescanRaw();
        const rescanResult = adminConnectorsValidator.validateRescanStatus(rescanResponse.status());
        expect(rescanResult.errors, rescanResult.errors.join('\n')).toHaveLength(0);
        console.info(`Rescan status: ${rescanResponse.status()}`);

        const ingestedSecondResult = await rawItemRepository.pollBySourceAndExternalId('file-system', file2);
        const ingestedSecond = ingestedSecondResult.rows;
        expect(ingestedSecond.length, 'file-2.txt was not ingested after folder rename').toBeGreaterThan(0);

        console.info('--- Local files folder rename ingestion test end');
      } finally {
        if (instanceId !== null && originalSettingsJson) {
          const restoreResponse = await adminInstancesRepository.updateAdminInstanceRaw(instanceId, {
            settingsJson: originalSettingsJson
          });
          const restoreStatusResult = settingsValidator.validateUpdateStatus(restoreResponse.status());
          if (restoreStatusResult.errors.length > 0) {
            console.error(restoreStatusResult.errors.join('\n'));
          } else {
            console.info(
              `Restore file-system settings for instance ${instanceId}: HTTP ${restoreResponse.status()}`
            );
          }
        }

        await fs.promises.rm(scenarioRoot, { recursive: true, force: true });
        console.info(`Cleanup complete for scenario root: ${scenarioRoot}`);
      }
    }
  );
});
