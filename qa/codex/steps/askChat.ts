import { request } from '@playwright/test';
import { ChatRepository } from '../../../src/api/repositories/ChatRepository';
import { CodexRunContext, GmailChatCase } from '../types';

export async function askChat(context: CodexRunContext): Promise<void> {
  const caseData = context.caseData as GmailChatCase;
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';

  console.info('Step 3: Asking chat...');
  const requestContext = await request.newContext({
    ignoreHTTPSErrors: true
  });

  try {
    const chatRepository = new ChatRepository(requestContext, apiBaseUrl);
    const payload = {
      query: caseData.question,
      model: 'string',
      includeAnswerLog: true
    };

    context.bundle.chat.apiBaseUrl = apiBaseUrl;
    context.bundle.chat.payload = payload;

    const responseRaw = await chatRepository.sendChatRaw(payload);
    context.bundle.chat.status = responseRaw.status();
    const parsed = await chatRepository.parseChatResponse(responseRaw);
    context.bundle.chat.errors = parsed.errors;
    context.bundle.chat.answer = parsed.body?.answer ?? null;
    context.bundle.chat.citations = parsed.body?.citations ?? null;
    context.bundle.chat.answerLog = parsed.body?.answerLog ?? null;

    if (parsed.errors.length > 0) {
      throw new Error(`Chat response parse errors: ${parsed.errors.join('; ')}`);
    }
    if (!parsed.body?.answer) {
      throw new Error('Chat response missing answer.');
    }
  } finally {
    await requestContext.dispose();
  }
}
