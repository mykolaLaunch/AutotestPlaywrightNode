import { ChatAnswerLog, ChatResponse } from '../../api/models/chat';
import { ValidationResult } from './ValidationResult';

export class MixedRetrievalValidator {
  public validateMixedRetrievalUsage(response: ChatResponse): ValidationResult {
    const errors: string[] = [];

    const citationsCount = response.citations?.length ?? 0;
    if (citationsCount <= 0) {
      errors.push('Expected citations for mixed context answers.');
    }

    const retrieval = response.answerLog?.retrieval ?? {};
    const totalDataItems = retrieval.totalDataItems ?? 0;
    const totalChunks = retrieval.totalChunks ?? 0;
    if (totalDataItems <= 0) {
      errors.push('Expected retrieval to include data items for mixed context answers.');
    }
    if (totalChunks <= 0) {
      errors.push('Expected retrieval to include chunks for mixed context answers.');
    }

    const stepResults = Array.isArray(response.answerLog?.stepResults) ? response.answerLog!.stepResults : [];
    const stepDataItemCount = stepResults.reduce((sum, step) => sum + (step.dataItemCount ?? 0), 0);
    if (stepDataItemCount <= 0) {
      errors.push('Expected stepResults to include data items for mixed context answers.');
    }

    this.logErrors('Mixed retrieval usage validation', errors);
    return { errors };
  }

  public validateStrategyAndChaining(
    answerLog: ChatAnswerLog | undefined,
    expectedStrategy?: string
  ): ValidationResult {
    const errors: string[] = [];

    if (!answerLog) {
      errors.push('Expected answerLog to be present for mixed context answers.');
      this.logErrors('Strategy/chaining validation', errors);
      return { errors };
    }

    if (expectedStrategy && answerLog.resolvedStrategy !== expectedStrategy) {
      errors.push(`Expected resolvedStrategy to be ${expectedStrategy}, got ${answerLog.resolvedStrategy ?? 'none'}.`);
    }

    const steps = Array.isArray(answerLog.steps) ? answerLog.steps : [];
    if (steps.length <= 0) {
      errors.push('Expected answerLog.steps to be non-empty.');
    }

    const stepIds = new Set<string>();
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      if (i > 0) {
        if (!step.dependsOn) {
          errors.push('Expected steps to chain via dependsOn.');
        } else if (!stepIds.has(step.dependsOn)) {
          errors.push('Expected dependsOn to reference a previous step id.');
        }
      }
      if (step.id) {
        stepIds.add(step.id);
      }
    }

    const firstRetrieveIndex = steps.findIndex((step) => step.type === 'retrieve');
    if (firstRetrieveIndex < 0) {
      errors.push('Expected at least one retrieve step in mixed context answers.');
    }

    if (expectedStrategy === 'ContextFirst' && firstRetrieveIndex !== 0) {
      errors.push('Expected retrieve step to be first for ContextFirst strategy.');
    }
    if (expectedStrategy === 'AiFirst' && firstRetrieveIndex <= 0) {
      errors.push('Expected retrieve step to occur after AI step for AiFirst strategy.');
    }

    this.logErrors('Strategy/chaining validation', errors);
    return { errors };
  }

  private logErrors(context: string, errors: string[]): void {
    if (errors.length === 0) {
      console.info(`${context}: no errors.`);
      return;
    }
    console.error(`${context}: ${errors.length} error(s).`);
    for (const err of errors) {
      console.error(`- ${err}`);
    }
  }
}
