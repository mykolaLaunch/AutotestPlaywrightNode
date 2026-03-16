import { expect, test } from '@playwright/test';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { AdminInstancesValidator } from '../../src/api/validators/AdminInstancesValidator';
import { RawItemRepository } from '../../src/db/repositories/RawItemRepository';
import { ChatRepository } from '../../src/api/repositories/ChatRepository';
import { ChatValidator } from '../../src/api/validators/ChatValidator';
import { FileTreeRepository } from '../../src/repositories/FileTreeRepository';
import { FileSystemValidator } from '../../src/db/validators/FileSystemValidator';

test('Chat Test', async ({ request }) => {
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
  const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);
  const adminInstancesValidator = new AdminInstancesValidator();

  const adminInstancesResponse = await adminInstancesRepository.getAdminInstancesRaw();
  const adminValidation = await adminInstancesValidator.validate(adminInstancesResponse);

  const chatValidator = new ChatValidator();
  const chatRepo = new ChatRepository(request, apiBaseUrl);
  const ask = {
    query: 'I have mails from uewek87@gmail.com   ?',
    sessionId: 14,
    model: 'string',
    attachmentIds: [0],
    includeAnswerLog: true
  };
  const chatResponse = await chatRepo.sendChatRaw(ask);
  const parsed = await chatRepo.parseChatResponse(chatResponse);
  const chatValidation = parsed.body
    ? chatValidator.validateSourceUsage(parsed.body, {
        source: 'gmail',
        externalIds: ['19c8c0b2f79f6627', '19c96bd97dc637ce']
      })
    : { errors: ['Chat response body was not parsed.'] };

  const errors = [...adminValidation.errors, ...parsed.errors, ...chatValidation.errors];
  expect(errors, errors.join('\n')).toHaveLength(0);
});

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
