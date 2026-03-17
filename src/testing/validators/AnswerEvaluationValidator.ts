import { loadEnvOnce } from '../utils/envLoader';
import { ValidationResult } from './ValidationResult';

export interface AnswerExpectations {
  mustContain?: string[];
  mustMatch?: Array<RegExp | string | { pattern: string; flags?: string }>;
  mustNotContain?: string[];
}

export interface AnswerEvaluation {
  passed: boolean;
  reason?: string;
  rulePassed?: boolean;
  llmUsed?: boolean;
  mode?: 'rule-only' | 'llm-used' | 'llm-skipped';
}

interface LlmEvalRequest {
  question: string;
  answer: string;
  expectations?: AnswerExpectations;
}

interface LlmEvalResponse {
  passed: boolean;
  reason?: string;
}

const DEFAULT_RUBRIC =
  'Judge if the answer correctly addresses the question. Mark passed=true if correct, otherwise passed=false with a short reason. Return only JSON: {"passed": boolean, "reason": string?}.';

export class AnswerEvaluationValidator {
  public async evaluate(
    question: string,
    answer: string,
    expectations: AnswerExpectations
  ): Promise<AnswerEvaluation> {
    loadEnvOnce();
    const ruleResult = this.evaluateWithKeywords(answer, expectations);
    if (ruleResult.passed || !this.isLlmEnabled()) {
      return {
        ...ruleResult,
        rulePassed: ruleResult.passed,
        llmUsed: false,
        mode: ruleResult.passed ? 'rule-only' : 'llm-skipped'
      };
    }

    const llmResult = await this.evaluateWithLlm({ question, answer, expectations });

    if (llmResult.passed) {
      return { ...llmResult, rulePassed: false, llmUsed: true, mode: 'llm-used' };
    }

    const combinedReason = [ruleResult.reason, llmResult.reason].filter(Boolean).join(' ');
    return {
      passed: false,
      reason: combinedReason || llmResult.reason || ruleResult.reason,
      rulePassed: false,
      llmUsed: true,
      mode: 'llm-used'
    };
  }

  public async validate(
    question: string,
    answer: string,
    expectations: AnswerExpectations
  ): Promise<{ evaluation: AnswerEvaluation; result: ValidationResult }> {
    const evaluation = await this.evaluate(question, answer, expectations);
    const errors: string[] = [];

    if (!evaluation.passed) {
      errors.push(evaluation.reason ?? 'Answer evaluation failed');
    }

    return { evaluation, result: { errors } };
  }

  private evaluateWithKeywords(answer: string, expectations: AnswerExpectations): AnswerEvaluation {
    const normalized = answer.toLowerCase();

    for (const phrase of expectations.mustContain ?? []) {
      if (!normalized.includes(phrase.toLowerCase())) {
        return { passed: false, reason: `Expected answer to contain "${phrase}".` };
      }
    }

    for (const entry of expectations.mustMatch ?? []) {
      const re = this.toRegex(entry);
      if (re && !re.test(answer)) {
        return { passed: false, reason: `Expected answer to match ${re}.` };
      }
    }

    for (const phrase of expectations.mustNotContain ?? []) {
      if (normalized.includes(phrase.toLowerCase())) {
        return { passed: false, reason: `Expected answer to not contain "${phrase}".` };
      }
    }

    return { passed: true };
  }

  private toRegex(
    entry: RegExp | string | { pattern: string; flags?: string } | null | undefined
  ): RegExp | null {
    if (!entry) return null;
    if (entry instanceof RegExp) return entry;
    if (typeof entry === 'string') return new RegExp(entry);
    if (typeof entry === 'object') {
      const pattern = entry.pattern ?? '';
      const flags = entry.flags ?? '';
      return new RegExp(pattern, flags);
    }
    return null;
  }

  private isLlmEnabled(): boolean {
    loadEnvOnce();
    return Boolean(process.env.EVAL_LLM_URL && process.env.EVAL_LLM_MODEL);
  }

  private async evaluateWithLlm(request: LlmEvalRequest): Promise<AnswerEvaluation> {
    loadEnvOnce();
    const url = process.env.EVAL_LLM_URL ?? 'https://api.openai.com/v1/chat/completions';
    if (!url.startsWith('https://api.openai.com/')) {
      return {
        passed: false,
        reason: 'EVAL_LLM_URL must point to https://api.openai.com/ for LLM evaluation.'
      };
    }

    const apiKey = process.env.EVAL_LLM_API_KEY;
    if (!apiKey) {
      return {
        passed: false,
        reason: 'EVAL_LLM_API_KEY is not set for LLM evaluation.'
      };
    }

    const model = process.env.EVAL_LLM_MODEL;
    if (!model) {
      return {
        passed: false,
        reason: 'EVAL_LLM_MODEL is not set for LLM evaluation.'
      };
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    headers.Authorization = `Bearer ${apiKey}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: DEFAULT_RUBRIC },
            {
              role: 'user',
              content: `Question: ${request.question}\nAnswer: ${request.answer}\nExpectations: ${JSON.stringify(
                request.expectations ?? null
              )}`
            }
          ]
        })
      });
    } catch (err) {
      return {
        passed: false,
        reason: `LLM evaluation request failed: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    if (!response.ok) {
      return {
        passed: false,
        reason: `LLM evaluation failed with status ${response.status}.`
      };
    }

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    } catch (err) {
      return {
        passed: false,
        reason: `LLM evaluation returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed = this.safeParseJson(content);
    if (!parsed || typeof parsed.passed !== 'boolean') {
      return {
        passed: false,
        reason: 'LLM evaluation returned an invalid response.'
      };
    }

    return { passed: parsed.passed, reason: parsed.reason };
  }

  private safeParseJson(content: string): LlmEvalResponse | null {
    try {
      return JSON.parse(content) as LlmEvalResponse;
    } catch {
      return null;
    }
  }
}
