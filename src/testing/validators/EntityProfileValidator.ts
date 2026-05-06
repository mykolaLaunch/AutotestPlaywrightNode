import { ChatResponse } from '../../api/models/chat';
import { ValidationResult } from './ValidationResult';

export interface EntityProfileValidationOptions {
  requireCitations?: boolean;
  requireRetrievalData?: boolean;
  requireSteps?: boolean;
}

export class EntityProfileValidator {
  public validateEntityProfileUsage(
    body: ChatResponse,
    options: EntityProfileValidationOptions = {}
  ): ValidationResult {
    const errors: string[] = [];

    const requireCitations = options.requireCitations ?? false;
    if (requireCitations) {
      const citationsCount = body.citations?.length ?? 0;
      if (citationsCount <= 0) {
        errors.push('Expected citations for entity profile answers.');
      }
    }

    const answerLog = body.answerLog;
    if (!answerLog) {
      errors.push('Expected answerLog to be present for entity profile answers.');
      this.logErrors('Entity profile validation', errors);
      return { errors };
    }

    const requireSteps = options.requireSteps ?? false;
    if (requireSteps) {
      const steps = Array.isArray(answerLog.steps) ? answerLog.steps : [];
      if (steps.length <= 0) {
        errors.push('Expected answerLog.steps to be non-empty.');
      }

      const hasEntityProfile = steps.some(
        (step) => (step.retrieveKind ?? '').toLowerCase() === 'entity_profile'
      );
      if (!hasEntityProfile) {
        errors.push('Expected at least one step with retrieveKind=entity_profile.');
      }
    }

    const requireRetrievalData = options.requireRetrievalData ?? false;
    if (requireRetrievalData) {
      const retrieval = answerLog.retrieval ?? {};
      const totalDataItems = retrieval.totalDataItems ?? 0;
      const stepResults = Array.isArray(answerLog.stepResults) ? answerLog.stepResults : [];
      const stepDataItemCount = stepResults.reduce((sum, step) => sum + (step.dataItemCount ?? 0), 0);
      if (totalDataItems <= 0 && stepDataItemCount <= 0) {
        errors.push('Expected entity profile retrieval to include data items.');
      }
    }

    this.logErrors('Entity profile validation', errors);
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
