import { test, expect } from '../testLogger';
import { ChatRepository } from '../../src/api/repositories/ChatRepository';
import { AnswerEvaluationValidator } from '../../src/testing/validators/AnswerEvaluationValidator';
import { buildExpectationsLabel } from '../../src/testing/utils/expectationsLabel';
import { ChatLogRepository } from '../../src/testing/repositories/ChatLogRepository';

test.describe('Memory facts from puzzle dataset', () => {
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
  const specId = 'chat-memory-facts';

  test('TC-MEM-001 - Daily rewards facts', async ({ request }) => {
    const chatRepo = new ChatRepository(request, apiBaseUrl);
    const evaluationValidator = new AnswerEvaluationValidator();
    const chatLogRepository = new ChatLogRepository();
    const payload = {
      query: 'Describe the daily rewards system in the puzzle game dataset.',
      model: 'string',
      includeAnswerLog: true
    };

    const expectations = {
      mustContain: ['daily rewards', '7', 'rare chest'],
      mustNotContain: ['battle pass', 'multiplayer']
    };

    console.info('--- Test start: TC-MEM-001');
    console.info(`Question: ${payload.query}`);
    console.info(`Expectations: ${buildExpectationsLabel(expectations)}`);

    const response = await chatRepo.sendChat(payload);
    console.info('--- Response received');
    console.info(`Answer: ${response.answer}`);
    console.info(`Citations count: ${response.citations?.length ?? 0}`);

    const evaluation = await evaluationValidator.evaluate(payload.query, response.answer, expectations);
    console.info('--- Answer evaluation');
    console.info(`Mode: ${evaluation.mode ?? 'unknown'}`);
    console.info(`Passed: ${evaluation.passed}`);
    if (evaluation.reason) {
      console.info(`Reason: ${evaluation.reason}`);
    }

    expect(evaluation.passed, evaluation.reason ?? 'Answer evaluation failed').toBe(true);
    await chatLogRepository.appendCollectorLog(specId, 'TC-MEM-001', 's1', payload.query, response, expectations, evaluation);
  });

  test('TC-MEM-002 - Monetization facts', async ({ request }) => {
    const chatRepo = new ChatRepository(request, apiBaseUrl);
    const evaluationValidator = new AnswerEvaluationValidator();
    const chatLogRepository = new ChatLogRepository();
    const payload = {
      query: 'What monetization does the puzzle game use?',
      model: 'string',
      includeAnswerLog: true
    };

    const expectations = {
      mustContain: ['rewarded ads', 'interstitial'],
      mustNotContain: ['subscription', 'battle pass', 'trading']
    };

    console.info('--- Test start: TC-MEM-002');
    console.info(`Question: ${payload.query}`);
    console.info(`Expectations: ${buildExpectationsLabel(expectations)}`);

    const response = await chatRepo.sendChat(payload);
    console.info('--- Response received');
    console.info(`Answer: ${response.answer}`);
    console.info(`Citations count: ${response.citations?.length ?? 0}`);

    const evaluation = await evaluationValidator.evaluate(payload.query, response.answer, expectations);
    console.info('--- Answer evaluation');
    console.info(`Mode: ${evaluation.mode ?? 'unknown'}`);
    console.info(`Passed: ${evaluation.passed}`);
    if (evaluation.reason) {
      console.info(`Reason: ${evaluation.reason}`);
    }

    expect(evaluation.passed, evaluation.reason ?? 'Answer evaluation failed').toBe(true);
    await chatLogRepository.appendCollectorLog(specId, 'TC-MEM-002', 's1', payload.query, response, expectations, evaluation);
  });
});
