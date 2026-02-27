export interface ChatRequestPayload {
  query: string;
  model: string;
  attachmentIds?: number[];
  includeAnswerLog?: boolean;
  sessionId?: number;
}

export interface ChatCitation {
  dataItemType: string | null;
  graphId: string | null;
  source: string | null;
  externalId: string | null;
  titleOrSubject: string | null;
  createdAtUtc: string | null;
  snippet: string | null;
  collectionType: string | null;
  collectionName: string | null;
  authorDisplay: string | null;
  authorEmail: string | null;
  labels: unknown;
}

export interface ChatRetrievalChunk {
  chunkId: string;
  score: number;
  textPreview: string;
  dataItem: {
    graphId: string;
    source: string;
    externalId: string;
    dataItemType: string;
    titleOrSubject: string | null;
    createdAtUtc: string;
  };
  entities: Array<{
    label: string;
    key: string;
    display: string;
  }>;
}

export interface ChatAnswerLog {
  originalQuery: string;
  rewrittenQuery?: string;
  retrieval?: {
    totalChunks?: number;
    totalDataItems?: number;
    chunks?: ChatRetrievalChunk[];
  };
}

export interface ChatResponse {
  answer: string;
  citations: ChatCitation[];
  sessionId: number;
  userMessageId?: number;
  assistantMessageId?: number;
  createdAtUtc?: string;
  answerLog?: ChatAnswerLog;
}
