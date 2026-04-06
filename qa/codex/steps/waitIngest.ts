import { RawItemRepository } from '../../../src/db/repositories/RawItemRepository';
import { CodexRunContext, GmailChatCase, IngestAttemptLog } from '../types';
import { delay } from '../utils/io';

export async function waitIngest(context: CodexRunContext): Promise<void> {
  const caseData = context.caseData as GmailChatCase;
  const messageId = context.bundle.email.messageId;
  if (!messageId) {
    throw new Error('waitIngest: missing messageId from send step.');
  }

  const maxAttempts = Number.isFinite(caseData.maxIngestAttempts)
    ? Math.max(1, Math.floor(caseData.maxIngestAttempts as number))
    : 40;
  const waitMs = Number.isFinite(caseData.ingestWaitMs)
    ? Math.max(250, Math.floor(caseData.ingestWaitMs as number))
    : 3000;

  const rawItemRepository = new RawItemRepository();
  const attempts: IngestAttemptLog[] = [];
  let matchedRows: unknown[] = [];

  console.info('Step 2: Waiting for ingest...');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rows = await rawItemRepository.getBySourceAndExternalId('gmail', messageId);
    const found = rows.length > 0;
    attempts.push({
      attempt,
      found,
      rowCount: rows.length,
      at: new Date().toISOString()
    });
    console.info(`Ingest poll ${attempt}/${maxAttempts}: found=${found} rows=${rows.length}`);
    if (found) {
      matchedRows = rows;
      break;
    }
    if (attempt < maxAttempts) {
      await delay(waitMs);
    }
  }

  context.bundle.ingest = {
    found: matchedRows.length > 0,
    attempts,
    matchedRowsCount: matchedRows.length
  };

  if (matchedRows.length === 0) {
    throw new Error('Ingest wait timed out: raw_item not found for sent message.');
  }
}
