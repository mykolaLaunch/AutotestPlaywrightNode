import { expect } from '../testLogger';
import { ChatResponse } from '../../src/api/models/chat';
import { GeneralKnowledgeValidator } from '../../src/testing/validators/GeneralKnowledgeValidator';

const validator = new GeneralKnowledgeValidator();

export function assertNoPersonalDataUsage(body: ChatResponse): void {
  const result = validator.validateNoPersonalDataUsage(body);
  expect(result.errors, result.errors.join('\n')).toHaveLength(0);
}
