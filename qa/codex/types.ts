export type CodexCaseType = 'gmail-chat';

export interface CodexCaseBase {
  id: string;
  type: CodexCaseType;
  command?: string;
  steps?: string[];
}

export interface GmailChatCase extends CodexCaseBase {
  type: 'gmail-chat';
  subject: string;
  body: string;
  question: string;
  maxIngestAttempts?: number;
  ingestWaitMs?: number;
}

export type CodexCase = GmailChatCase;

export interface IngestAttemptLog {
  attempt: number;
  found: boolean;
  rowCount: number;
  at: string;
}

export interface CodexRunBundle {
  runId: string;
  caseId: string;
  caseFile: string;
  case: {
    id: string;
    type: CodexCaseType;
    subject?: string;
    body?: string;
    question?: string;
    command: string | null;
  };
  email: {
    from: string;
    to: string;
    messageId: string | null;
    threadId: string | null;
    sentAt: string | null;
  };
  ingest: {
    found: boolean;
    attempts: IngestAttemptLog[];
    matchedRowsCount: number;
  };
  chat: {
    apiBaseUrl: string;
    payload: unknown;
    status: number | null;
    errors: string[];
    answer: string | null;
    citations: unknown;
    answerLog: unknown;
  };
  timestamps: {
    startedAt: string;
    finishedAt: string | null;
  };
  failureReason: string | null;
}

export interface CodexRunContext {
  caseFilePath: string;
  runId: string;
  startedAt: string;
  bundlePath: string;
  caseData: CodexCase;
  bundle: CodexRunBundle;
}
