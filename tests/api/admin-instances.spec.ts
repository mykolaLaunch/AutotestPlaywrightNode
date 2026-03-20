import { test, expect } from '../testLogger';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { AdminInstancesValidator } from '../../src/api/validators/AdminInstancesValidator';
import { ChatRepository } from '../../src/api/repositories/ChatRepository';
import { ChatValidator } from '../../src/api/validators/ChatValidator';

test('Chat Test', async ({ request }) => {
  console.info('--- Admin instances chat test start');
  console.info('Action: fetch admin instances, then validate chat source usage.');
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
  const adminInstancesRepository = new AdminInstancesRepository(request, apiBaseUrl);
  const adminInstancesValidator = new AdminInstancesValidator();

  const adminInstancesResponse = await adminInstancesRepository.getAdminInstancesRaw();
  const adminValidation = await adminInstancesValidator.validate(adminInstancesResponse);
  console.info(`Admin instances validation errors: ${adminValidation.errors.length}`);

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
  console.info(`Chat parse errors: ${parsed.errors.length}`);
  const chatValidation = parsed.body
    ? chatValidator.validateSourceUsage(parsed.body, {
        source: 'gmail',
        externalIds: ['19c8c0b2f79f6627', '19c96bd97dc637ce']
      })
    : { errors: ['Chat response body was not parsed.'] };
  console.info(`Chat validation errors: ${chatValidation.errors.length}`);

  const errors = [...adminValidation.errors, ...parsed.errors, ...chatValidation.errors];
  if (errors.length > 0) {
    console.info(`Validation errors: ${errors.length}`);
    console.info(errors.join('\n'));
  }
  expect(errors, errors.join('\n')).toHaveLength(0);
  console.info('--- Admin instances chat test end');
});
