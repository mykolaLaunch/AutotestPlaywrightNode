import { test, expect } from '../testLogger';
import { ChatRepository } from '../../src/api/repositories/ChatRepository';
import {
  AnswerEvaluationValidator,
  AnswerExpectations,
  AnswerEvaluation
} from '../../src/testing/validators/AnswerEvaluationValidator';
import { ChatLogRepository } from '../../src/testing/repositories/ChatLogRepository';
import { buildExpectationsLabel } from '../../src/testing/utils/expectationsLabel';
import { TestCaseRepository } from '../../src/testing/repositories/TestCaseRepository';
import { MixedRetrievalValidator } from '../../src/testing/validators/MixedRetrievalValidator';
import { mergeResults } from '../../src/testing/validators/ValidationResult';

interface MixedRetrievalCase {
  id: string;
  question: string;
  expectedStrategy?: string;
  expectations?: AnswerExpectations;
}

const specId = 'chat-mixed-retrieval';
const testCaseRepository = new TestCaseRepository();
const cases: MixedRetrievalCase[] = testCaseRepository.getMixedRetrievalCases();

test.describe('Mixed context + external knowledge cases', () => {
  for (const tc of cases) {
    test(`${tc.id} - Mixed retrieval should chain context and external knowledge`, async ({ request }) => {
      const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5199';
      const chatRepo = new ChatRepository(request, apiBaseUrl);
      const evaluationValidator = new AnswerEvaluationValidator();
      const mixedRetrievalValidator = new MixedRetrievalValidator();
      const chatLogRepository = new ChatLogRepository();

      const payload = {
        query: tc.question,
        model: 'string',
        includeAnswerLog: true
      };

      console.info(`--- Test start: ${tc.id}`);
      console.info(`Question: ${payload.query}`);
      console.info(`Expected strategy: ${tc.expectedStrategy ?? 'unspecified'}`);
      console.info(`Expectations: ${buildExpectationsLabel(tc.expectations ?? {})}`);

      const responseRaw = await chatRepo.sendChatRaw(payload);
      const parsed = await chatRepo.parseChatResponse(responseRaw);

      console.info('--- Response received');
      if (parsed.body) {
        console.info(`Answer: ${parsed.body.answer}`);
        console.info(`Citations count: ${parsed.body.citations?.length ?? 0}`);
        console.info(
          `AnswerLog retrieval: totalDataItems=${parsed.body.answerLog?.retrieval?.totalDataItems ?? 0}, totalChunks=${parsed.body.answerLog?.retrieval?.totalChunks ?? 0}`
        );
      }

      const validationErrors: string[] = [...parsed.errors];

      let evaluation: AnswerEvaluation = { passed: false };
      if (parsed.body) {
        const evaluationResult = await evaluationValidator.validate(
          payload.query,
          parsed.body.answer,
          tc.expectations ?? {}
        );
        evaluation = evaluationResult.evaluation;
        const retrievalResult = mixedRetrievalValidator.validateMixedRetrievalUsage(parsed.body);
        const strategyResult = mixedRetrievalValidator.validateStrategyAndChaining(
          parsed.body.answerLog,
          tc.expectedStrategy
        );
        const combined = mergeResults(retrievalResult, strategyResult, evaluationResult.result);
        validationErrors.push(...combined.errors);
      } else {
        validationErrors.push('Chat response body was not parsed.');
      }

      console.info('--- Answer evaluation');
      console.info(`Mode: ${evaluation.mode ?? 'unknown'}`);
      console.info(`Passed: ${evaluation.passed}`);
      if (evaluation.reason) {
        console.info(`Reason: ${evaluation.reason}`);
      }

      if (parsed.body) {
        await chatLogRepository.appendCollectorLog(specId, tc.id, 's1', payload.query, parsed.body, tc.expectations, {
          ...evaluation,
          failureReason: validationErrors.length ? validationErrors.join(' ') : undefined
        });
      }
      console.info(`--- Test end: ${tc.id}`);

      expect(validationErrors, validationErrors.join('\n')).toHaveLength(0);
    });
  }
});
