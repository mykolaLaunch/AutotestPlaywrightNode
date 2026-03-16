import { APIResponse } from '@playwright/test';
import { ChatResponse, ChatCitation, ChatRetrievalChunk } from '../models/chat';
import { BaseResponseValidator } from './BaseResponseValidator';
import { ValidationResult } from './ValidationResult';

/**
 * Where to look for matching source/externalId.
 * - 'citations': only in body.citations
 * - 'chunks': only in body.answerLog.retrieval.chunks
 * - 'both': in citations and chunks (default)
 */
export type SourceSearchScope = 'citations' | 'chunks' | 'both';

/**
 * Options for validateSourceUsage().
 * @param source Required source value to look for (e.g. 'gmail', 'slack').
 * @param externalIds Optional externalId values to verify.
 * @param matchAll If true, every externalId must be found. If false, any one is enough.
 * @param scope Search scope: citations, chunks, or both.
 */
export interface SourceValidationOptions {
  source: string;
  externalIds?: string[];
  matchAll?: boolean;
  scope?: SourceSearchScope;
}

export class ChatValidator extends BaseResponseValidator {
  public async validate(response: APIResponse): Promise<ValidationResult> {
    console.info('.'.repeat(80));
    console.info('Validation started: POST /chat');

    const errors: string[] = [];
    const status = response.status();
    console.info(`HTTP status received: ${status}`);
    if (status !== 200) {
      errors.push(`POST /chat should return 200, got ${status}.`);
    }

    let body: ChatResponse | null = null;
    try {
      body = (await response.json()) as ChatResponse;
    } catch (err) {
      errors.push(
        `Failed to parse chat response JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (body) {
      errors.push(...this.validateCoreFields(body));
      this.logCitations(body.citations ?? []);
      this.logRetrievalChunks(body.answerLog?.retrieval?.chunks ?? []);
    }

    this.logErrors('Chat response validation', errors);
    console.info('.'.repeat(80));
    return { errors };
  }

  /**
   * Validates that the response contains items with the specified source,
   * and optionally checks specific externalId values.
   */
  public validateSourceUsage(body: ChatResponse, options: SourceValidationOptions): ValidationResult {
    const errors: string[] = [];
    const { source, externalIds, matchAll = false, scope = 'both' } = options;

    console.info('.'.repeat(80));
    console.info(`Response answer: ${body.answer}`);
    console.info(`validateSourceUsage: source="${source}", scope="${scope}"`);
    if (externalIds?.length) {
      console.info(`externalIds=${JSON.stringify(externalIds)}, matchAll=${matchAll}`);
    }

    const citationItems = scope !== 'chunks' ? this.extractFromCitations(body, source) : [];
    const chunkItems = scope !== 'citations' ? this.extractFromChunks(body, source) : [];
    const allItems = [...citationItems, ...chunkItems];

    console.info(
      `Found ${citationItems.length} citation(s) and ${chunkItems.length} chunk(s) with source="${source}"`
    );
    if (allItems.length === 0) {
      errors.push(`Expected at least one item with source="${source}" in scope="${scope}", but found none`);
    }

    if (externalIds && externalIds.length > 0) {
      const foundExternalIds = new Set(allItems.map((item) => item.externalId).filter(Boolean));
      console.info(`externalIds found in response: ${JSON.stringify([...foundExternalIds])}`);

      if (matchAll) {
        for (const id of externalIds) {
          if (!foundExternalIds.has(id)) {
            errors.push(
              `Expected externalId="${id}" in source="${source}" items (scope="${scope}"), but it was not found`
            );
          }
        }
        console.info(`All ${externalIds.length} externalId(s) found.`);
      } else {
        const anyFound = externalIds.some((id) => foundExternalIds.has(id));
        if (!anyFound) {
          errors.push(
            `Expected at least one externalId from ${JSON.stringify(
              externalIds
            )} in source="${source}" items (scope="${scope}"), but none were found`
          );
        }
        console.info('At least one externalId found.');
      }
    }

    this.logErrors(`validateSourceUsage for source="${source}"`, errors);
    console.info('.'.repeat(80));
    return { errors };
  }

  private extractFromCitations(body: ChatResponse, source: string): Array<{ externalId: string | null }> {
    return (body.citations ?? [])
      .filter((c) => c.source === source)
      .map((c) => ({ externalId: c.externalId ?? null }));
  }

  private extractFromChunks(body: ChatResponse, source: string): Array<{ externalId: string | null }> {
    return (body.answerLog?.retrieval?.chunks ?? [])
      .filter((ch) => ch.dataItem.source === source)
      .map((ch) => ({ externalId: ch.dataItem.externalId ?? null }));
  }

  private validateCoreFields(body: ChatResponse): string[] {
    const errors: string[] = [];
    console.info(`Answer: ${body.answer}`);
    if (typeof body.answer !== 'string') errors.push('answer should be string');

    console.info(`SessionId: ${body.sessionId}`);
    if (typeof body.sessionId !== 'number') errors.push('sessionId should be number');

    if (body.answerLog) {
      console.info(
        `AnswerLog: originalQuery="${body.answerLog.originalQuery}", rewritten="${body.answerLog.rewrittenQuery ?? ''}"`
      );
    }
    return errors;
  }

  private logCitations(citations: ChatCitation[]): void {
    console.info(`Citations count: ${citations.length}`);
    citations.forEach((c, idx) => {
      console.info(
        `- [${idx + 1}] source=${c.source}, dataItemType=${c.dataItemType}, graphId=${c.graphId}, title=${c.titleOrSubject}`
      );
    });
  }

  private logRetrievalChunks(chunks: ChatRetrievalChunk[]): void {
    console.info(`Retrieval chunks: ${chunks.length}`);
    chunks.forEach((chunk, idx) => {
      console.info(
        `- [${idx + 1}] chunkId=${chunk.chunkId}, score=${chunk.score}, source=${chunk.dataItem.source}, dataItemType=${chunk.dataItem.dataItemType}`
      );
    });
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
