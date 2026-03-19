import { ChatResponse } from '../../src/api/models/chat';
import { ChatLogRepository, CollectorLogEntry } from '../../src/testing/repositories/ChatLogRepository';

const repository = new ChatLogRepository();

export { CollectorLogEntry };

export async function appendCollectorLog(
  specId: string,
  caseId: string,
  stepId: string,
  question: string,
  response: ChatResponse,
  expectations?: unknown,
  evaluation?: {
    mode?: 'rule-only' | 'llm-used' | 'llm-skipped';
    llmUsed?: boolean;
    rulePassed?: boolean;
    passed?: boolean;
    reason?: string;
    failureReason?: string;
  }
): Promise<void> {
  await repository.appendCollectorLog(specId, caseId, stepId, question, response, expectations, evaluation);
}
