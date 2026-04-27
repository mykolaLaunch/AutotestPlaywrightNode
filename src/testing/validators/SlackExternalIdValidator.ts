import { ValidationResult } from './ValidationResult';

export interface SlackDbIngestionRow {
  externalThread: string;
  messageUtcIso: string;
  messageUtcMs: number;
  createdUtcIso: string;
  createdUtcMs: number;
}

export interface SlackDbIngestionOrderRow {
  id: number;
  createdUtcIso: string;
  createdUtcMs: number;
}

export interface SlackNeo4jIngestionOrderRow {
  externalId: string;
  rawVersionId: number;
  createdAtUtcIso: string;
  createdAtUtcMs: number;
}

export class SlackExternalIdValidator {
  public validateSlackIdsPresentInDb(slackIds: string[], dbExternalThreads: string[]): ValidationResult {
    const errors: string[] = [];

    if (slackIds.length === 0) {
      errors.push('No Slack message ids were returned.');
    }

    const dbSet = new Set(dbExternalThreads);
    const missing: string[] = [];

    for (const id of slackIds) {
      if (!dbSet.has(id)) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 50);
      errors.push(
        `DB is missing ${missing.length} Slack external_thread(s). First ${preview.length}: ${preview.join(', ')}`
      );
    }

    this.logErrors('Slack external_thread validation', errors);
    return { errors };
  }

  public validateDbExternalIds(rawExternalThreads: Array<unknown>): { externalIds: string[]; result: ValidationResult } {
    const errors: string[] = [];
    const externalIds: string[] = [];

    for (const value of rawExternalThreads) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push('DB row has invalid external_thread (expected non-empty string).');
        continue;
      }
      externalIds.push(value);
    }

    this.logErrors('DB external_thread validation', errors);
    return { externalIds, result: { errors } };
  }

  public validateDbRowsForCreatedUtcAndExternalThread(
    rawRows: Array<unknown>
  ): { items: SlackDbIngestionRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: SlackDbIngestionRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { external_thread?: unknown; created_utc?: unknown };
      if (typeof row.external_thread !== 'string' || row.external_thread.trim() === '') {
        errors.push('DB row has invalid external_thread (expected non-empty string).');
        continue;
      }

      const messageUtcMs = this.parseSlackTsToMs(row.external_thread);
      if (messageUtcMs === null) {
        errors.push(`DB row has invalid Slack ts external_thread=${row.external_thread}.`);
        continue;
      }

      const createdUtcMs = this.parseDateToMs(row.created_utc);
      if (createdUtcMs === null) {
        errors.push(`DB row has invalid created_utc for external_thread=${row.external_thread}.`);
        continue;
      }

      items.push({
        externalThread: row.external_thread,
        messageUtcIso: new Date(messageUtcMs).toISOString(),
        messageUtcMs,
        createdUtcIso: new Date(createdUtcMs).toISOString(),
        createdUtcMs
      });
    }

    this.logErrors('DB created_utc + external_thread validation', errors);
    return { items, result: { errors } };
  }

  public validateMessageCreatedUtcOrder(
    items: SlackDbIngestionRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough DB rows to validate message ts/created_utc order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('Slack created_utc order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.messageUtcMs - b.messageUtcMs || a.createdUtcMs - b.createdUtcMs);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.messageUtcMs < next.messageUtcMs && current.createdUtcMs > next.createdUtcMs) {
        errors.push(
          `Order mismatch: message ${current.externalThread} (${current.messageUtcIso}) has created_utc ${current.createdUtcIso} but later message ${next.externalThread} (${next.messageUtcIso}) has earlier created_utc ${next.createdUtcIso}.`
        );
      }
    }

    this.logErrors('Slack created_utc order validation', errors);
    return { errors };
  }

  public validateDbRowsForCreatedUtcAndId(
    rawRows: Array<unknown>
  ): { items: SlackDbIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: SlackDbIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { id?: unknown; created_utc?: unknown };
      const id = this.parseIdToNumber(row.id);
      if (id === null) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }

      const createdUtcMs = this.parseDateToMs(row.created_utc);
      if (createdUtcMs === null) {
        errors.push(`DB row has invalid created_utc for id=${id}.`);
        continue;
      }

      items.push({
        id,
        createdUtcIso: new Date(createdUtcMs).toISOString(),
        createdUtcMs
      });
    }

    this.logErrors('DB created_utc + id validation', errors);
    return { items, result: { errors } };
  }

  public validateCreatedUtcIdOrder(
    items: SlackDbIngestionOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough DB rows to validate created_utc/id order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('DB created_utc/id order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.createdUtcMs - b.createdUtcMs || a.id - b.id);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.createdUtcMs < next.createdUtcMs && current.id <= next.id) {
        errors.push(
          `Order mismatch: created_utc ${current.createdUtcIso} (id=${current.id}) is earlier than ${next.createdUtcIso} (id=${next.id}), but id is not larger.`
        );
      }
    }

    this.logErrors('DB created_utc/id order validation', errors);
    return { errors };
  }

  public validateNeo4jRowsForCreatedAtAndRawVersion(
    rawRows: Array<unknown>
  ): { items: SlackNeo4jIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: SlackNeo4jIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { externalId?: unknown; rawVersionId?: unknown; createdAtUtc?: unknown };
      const externalId =
        typeof row.externalId === 'string' && row.externalId.trim() !== ''
          ? row.externalId
          : '(unknown externalId)';

      const rawVersionId = this.parseIdToNumber(row.rawVersionId);
      if (rawVersionId === null) {
        errors.push(`Neo4j row has invalid rawVersionId for externalId=${externalId}.`);
        continue;
      }

      const createdAtUtcMs = this.parseDateToMs(row.createdAtUtc);
      if (createdAtUtcMs === null) {
        errors.push(`Neo4j row has invalid createdAtUtc for externalId=${externalId}.`);
        continue;
      }

      items.push({
        externalId,
        rawVersionId,
        createdAtUtcIso: new Date(createdAtUtcMs).toISOString(),
        createdAtUtcMs
      });
    }

    this.logErrors('Neo4j createdAtUtc + rawVersionId validation', errors);
    return { items, result: { errors } };
  }

  public validateCreatedAtRawVersionOrder(
    items: SlackNeo4jIngestionOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough Neo4j rows to validate createdAtUtc/rawVersionId order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('Neo4j createdAtUtc/rawVersionId order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.createdAtUtcMs - b.createdAtUtcMs || a.rawVersionId - b.rawVersionId);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.createdAtUtcMs < next.createdAtUtcMs && current.rawVersionId <= next.rawVersionId) {
        errors.push(
          `Order mismatch: createdAtUtc ${current.createdAtUtcIso} (rawVersionId=${current.rawVersionId}) is earlier than ${next.createdAtUtcIso} (rawVersionId=${next.rawVersionId}), but rawVersionId is not larger.`
        );
      }
    }

    this.logErrors('Neo4j createdAtUtc/rawVersionId order validation', errors);
    return { errors };
  }

  private parseSlackTsToMs(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    const ms = Math.round(parsed * 1000);
    return Number.isFinite(ms) ? ms : null;
  }

  private parseDateToMs(value: unknown): number | null {
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isNaN(ms) ? null : ms;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value < 1e12 ? value * 1000 : value;
      return Number.isFinite(ms) ? ms : null;
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.getTime();
      }
    }

    if (value && typeof value === 'object') {
      const candidate = value as { toString?: unknown };
      if (typeof candidate.toString === 'function') {
        const parsed = new Date(String(value));
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
      }
    }

    return null;
  }

  private parseIdToNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    if (value && typeof value === 'object') {
      const candidate = value as { toNumber?: () => number; low?: unknown; high?: unknown };
      if (typeof candidate.toNumber === 'function') {
        const parsed = candidate.toNumber();
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof candidate.low === 'number' && typeof candidate.high === 'number') {
        const parsed = candidate.high * 2 ** 32 + candidate.low;
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    return null;
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
