import { AnswerExpectations } from '../validators/AnswerEvaluationValidator';

export function buildExpectationsLabel(expectations: AnswerExpectations): string {
  const parts: string[] = [];
  if (expectations.mustContain?.length) {
    parts.push(`mustContain=${JSON.stringify(expectations.mustContain)}`);
  }
  if (expectations.mustMatch?.length) {
    parts.push(`mustMatch=${expectations.mustMatch.map(String).join(',')}`);
  }
  if (expectations.mustNotContain?.length) {
    parts.push(`mustNotContain=${JSON.stringify(expectations.mustNotContain)}`);
  }
  return parts.length ? parts.join(' | ') : 'no expectations';
}
