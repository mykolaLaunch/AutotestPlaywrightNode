import { promises as fs } from 'fs';
import path from 'path';
import { ChatResponse } from '../../api/models/chat';
import { loadEnvOnce } from '../utils/envLoader';

export interface CollectorLogEntry {
  runId: string;
  specId: string;
  caseId: string;
  stepId: string;
  question: string;
  answer: string;
  expectations?: unknown;
  evaluationMode?: 'rule-only' | 'llm-used' | 'llm-skipped';
  llmUsed?: boolean;
  rulePassed?: boolean;
  evaluationPassed?: boolean;
  evaluationReason?: string;
  failureReason?: string;
  citationsCount: number;
  retrieval: {
    totalDataItems: number;
    totalChunks: number;
  };
  stepStats: {
    count: number;
    totalDataItemCount: number;
    totalChunkCount: number;
    totalDataItemsArrayLength: number;
  };
  sessionId?: number;
  timestamp: string;
}

export class ChatLogRepository {
  private cachedRunId: string | null = null;

  public async appendCollectorLog(
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
    if (this.getLogMode() !== 'collector') {
      return;
    }

    const filePath = this.getLogFilePath(specId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const entry = this.buildCollectorEntry(specId, caseId, stepId, question, response, expectations, evaluation);
    const existing = await this.readExistingEntries(filePath);
    existing.push(entry);
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8');
  }

  private getLogMode(): string {
    loadEnvOnce();
    return (process.env.CHAT_TEST_LOG_MODE ?? '').toLowerCase();
  }

  private getRunId(): string {
    if (process.env.CHAT_TEST_RUN_ID) {
      return process.env.CHAT_TEST_RUN_ID;
    }
    if (!this.cachedRunId) {
      this.cachedRunId = `run-${Date.now()}`;
    }
    return this.cachedRunId;
  }

  private getLogDir(): string {
    loadEnvOnce();
    return process.env.CHAT_TEST_LOG_DIR ?? 'test-results/chat-logs';
  }

  private getLogFilePath(specId: string): string {
    loadEnvOnce();
    const override = process.env.CHAT_TEST_LOG_FILE;
    if (override && override.trim().length > 0) {
      return path.resolve(process.cwd(), override);
    }
    const fileName = `${this.getRunId()}.json`;
    return path.resolve(process.cwd(), this.getLogDir(), this.dateStamp(), specId, fileName);
  }

  private buildCollectorEntry(
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
  ): CollectorLogEntry {
    const citationsCount = response.citations?.length ?? 0;
    const answerLog = response.answerLog ?? {};
    const retrieval = answerLog.retrieval ?? {};

    const stepResults = Array.isArray(answerLog.stepResults) ? answerLog.stepResults : [];
    let totalDataItemCount = 0;
    let totalChunkCount = 0;
    let totalDataItemsArrayLength = 0;

    for (const step of stepResults) {
      totalDataItemCount += step.dataItemCount ?? 0;
      totalChunkCount += step.chunkCount ?? 0;
      totalDataItemsArrayLength += Array.isArray(step.dataItems) ? step.dataItems.length : 0;
    }

    return {
      runId: this.getRunId(),
      specId,
      caseId,
      stepId,
      question,
      answer: response.answer ?? '',
      expectations,
      evaluationMode: evaluation?.mode,
      llmUsed: evaluation?.llmUsed,
      rulePassed: evaluation?.rulePassed,
      evaluationPassed: evaluation?.passed,
      evaluationReason: evaluation?.reason,
      failureReason: evaluation?.failureReason,
      citationsCount,
      retrieval: {
        totalDataItems: retrieval.totalDataItems ?? 0,
        totalChunks: retrieval.totalChunks ?? 0
      },
      stepStats: {
        count: stepResults.length,
        totalDataItemCount,
        totalChunkCount,
        totalDataItemsArrayLength
      },
      sessionId: response.sessionId,
      timestamp: new Date().toISOString()
    };
  }

  private async readExistingEntries(filePath: string): Promise<CollectorLogEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? (parsed as CollectorLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  private dateStamp(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
