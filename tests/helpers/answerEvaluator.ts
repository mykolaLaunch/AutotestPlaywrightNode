import { AnswerEvaluationValidator, AnswerExpectations, AnswerEvaluation } from '../../src/testing/validators/AnswerEvaluationValidator';
import { buildExpectationsLabel } from '../../src/testing/utils/expectationsLabel';

const evaluator = new AnswerEvaluationValidator();

export { AnswerExpectations, AnswerEvaluation, buildExpectationsLabel };

export async function evaluateAnswer(
  question: string,
  answer: string,
  expectations: AnswerExpectations
): Promise<AnswerEvaluation> {
  return evaluator.evaluate(question, answer, expectations);
}
