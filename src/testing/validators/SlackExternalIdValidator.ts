import { ValidationResult } from './ValidationResult';

export interface SlackDbIngestionRow {
  externalThread: string;
  messageUtcIso: string;
  messageUtcMs: number;
  createdUtcIso: string;
  createdUtcMs: number;
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
