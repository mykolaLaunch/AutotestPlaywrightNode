import { ChatResponse } from '../../api/models/chat';
import { ValidationResult } from './ValidationResult';

export class GeneralKnowledgeValidator {
  public validateNoPersonalDataUsage(body: ChatResponse): ValidationResult {
    const errors: string[] = [];

    const citationsCount = body.citations?.length ?? 0;
    if (citationsCount !== 0) {
      errors.push(`Expected no citations for general knowledge answers, got ${citationsCount}.`);
    }

    const answerLog = body.answerLog ?? {};
    const retrieval = answerLog.retrieval ?? {};

    const totalDataItems = retrieval.totalDataItems ?? 0;
    const totalChunks = retrieval.totalChunks ?? 0;
    if (totalDataItems !== 0) {
      errors.push(`Expected no retrieval data items for general knowledge answers, got ${totalDataItems}.`);
    }
    if (totalChunks !== 0) {
      errors.push(`Expected no retrieval chunks for general knowledge answers, got ${totalChunks}.`);
    }

    const stepResults = Array.isArray(answerLog.stepResults) ? answerLog.stepResults : [];
    for (const step of stepResults) {
      const dataItemCount = step.dataItemCount ?? 0;
      const chunkCount = step.chunkCount ?? 0;
      const dataItemsLen = Array.isArray(step.dataItems) ? step.dataItems.length : 0;

      if (dataItemCount !== 0) {
        errors.push(`Expected stepResults to have no data items, got ${dataItemCount}.`);
      }
      if (chunkCount !== 0) {
        errors.push(`Expected stepResults to have no chunks, got ${chunkCount}.`);
      }
      if (dataItemsLen !== 0) {
        errors.push(`Expected stepResults to have no dataItems array, got length ${dataItemsLen}.`);
      }
    }

    this.logErrors('General knowledge validation', errors);
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
