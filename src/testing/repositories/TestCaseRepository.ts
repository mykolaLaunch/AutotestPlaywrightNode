import fs from 'fs';
import path from 'path';
import { AnswerExpectations } from '../validators/AnswerEvaluationValidator';

export interface GeneralKnowledgeCase {
  id: string;
  question: string;
  expectations?: AnswerExpectations;
}

export interface MixedRetrievalCase {
  id: string;
  question: string;
  expectedStrategy?: string;
  expectations?: AnswerExpectations;
}

export class TestCaseRepository {
  private readonly baseDir: string;

  constructor(baseDir: string = path.join(process.cwd(), 'testCases')) {
    this.baseDir = baseDir;
  }

  public getGeneralKnowledgeCases(): GeneralKnowledgeCase[] {
    return this.readJson<GeneralKnowledgeCase[]>('chat-general-knowledge.json');
  }

  public getMixedRetrievalCases(): MixedRetrievalCase[] {
    return this.readJson<MixedRetrievalCase[]>('chat-mixed-retrieval.json');
  }

  private readJson<T>(fileName: string): T {
    const filePath = path.join(this.baseDir, fileName);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  }
}
