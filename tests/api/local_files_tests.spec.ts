import { expect, test } from '@playwright/test';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { FileTreeRepository } from '../../src/repositories/FileTreeRepository';
import { FileSystemValidator } from '../../src/db/validators/FileSystemValidator';

test.describe('Local files tests', { tag: ['@local-files', '@regression'] }, () => {
  test('File tree db source test', async () => {
    const fileRepository = new FileTreeRepository();
    const rawItemRepository = new RawItemRepository();
    const fileValidator = new FileSystemValidator();
    const fileRawItems = await rawItemRepository.getBySource('file-system');
    const fileSchema = await fileRepository.getFileDepthMap('TestFilesDirectory');
    const result = fileValidator.validate(fileRawItems, fileSchema);
    // const result = await fileValidator.validateDepthLoadOrder(fileRawItems, fileSchema);

    expect(result.errors, 'File system validation should not have errors').toBe(0);
  });
});
