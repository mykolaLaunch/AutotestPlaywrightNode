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
import { EntityProfileValidator } from '../../src/testing/validators/EntityProfileValidator';
import { mergeResults } from '../../src/testing/validators/ValidationResult';

interface EntityProfileCase {
  id: string;
  question: string;
  expectations?: AnswerExpectations;
}

const specId = 'chat-entity-profile';
const testCaseRepository = new TestCaseRepository();
const cases: EntityProfileCase[] = testCaseRepository.getEntityProfileCases();

test.describe('Entity profile cases (Alex Carter)', () => {
  for (const tc of cases) {
    test(`${tc.id} - Entity profile answer should use synthesized profile`, async ({ request }) => {
      const apiBaseUrl = process.env.API_BASE_URL ?? 'https://localhost:5198';
      const chatRepo = new ChatRepository(request, apiBaseUrl);
      const evaluationValidator = new AnswerEvaluationValidator();
      const entityProfileValidator = new EntityProfileValidator();
      const chatLogRepository = new ChatLogRepository();

      const payload = {
        query: tc.question,
        model: 'string',
        includeAnswerLog: true
      };

      console.info(`--- Test start: ${tc.id}`);
      console.info(`Question: ${payload.query}`);
      console.info('Expected: entity profile retrieval with citations.');
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
      const requireSteps = (process.env.ENTITY_PROFILE_VALIDATE_STEPS ?? '').toLowerCase() === 'true';
      const profileResult = entityProfileValidator.validateEntityProfileUsage(parsed.body, {
        requireCitations: false,
        requireRetrievalData: false,
        requireSteps
      });
        const evaluationResult = await evaluationValidator.validate(
          payload.query,
          parsed.body.answer,
          tc.expectations ?? {}
        );
        evaluation = evaluationResult.evaluation;
        const combined = mergeResults(profileResult, evaluationResult.result);
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
        await chatLogRepository.appendCollectorLog(
          specId,
          tc.id,
          's1',
          payload.query,
          parsed.body,
          tc.expectations,
          {
            ...evaluation,
            failureReason: validationErrors.length ? validationErrors.join(' ') : undefined
          }
        );
      }
      console.info(`--- Test end: ${tc.id}`);

      expect(validationErrors, validationErrors.join('\n')).toHaveLength(0);
    });
  }
});
