import { ValidationResult } from './ValidationResult';
import { GmailMessageDateInfo } from '../repositories/GmailRepository';

export interface GmailDbIngestionRow {
  externalId: string;
  createdUtcIso: string;
  createdUtcMs: number;
}

export interface GmailDbIngestionOrderRow {
  id: number;
  createdUtcIso: string;
  createdUtcMs: number;
}

export class GmailExternalIdValidator {
  public validateGmailIdsPresentInDb(gmailIds: string[], dbExternalIds: string[]): ValidationResult {
    const errors: string[] = [];

    if (gmailIds.length === 0) {
      errors.push('No Gmail message ids were returned.');
    }

    const dbSet = new Set(dbExternalIds);
    const missing: string[] = [];

    for (const id of gmailIds) {
      if (!dbSet.has(id)) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 50);
      errors.push(
        `DB is missing ${missing.length} Gmail external_id(s). First ${preview.length}: ${preview.join(', ')}`
      );
    }

    this.logErrors('Gmail external_id validation', errors);
    return { errors };
  }

  public validateDbExternalIds(rawExternalIds: Array<unknown>): { externalIds: string[]; result: ValidationResult } {
    const errors: string[] = [];
    const externalIds: string[] = [];

    for (const value of rawExternalIds) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors.push('DB row has invalid external_id (expected non-empty string).');
        continue;
      }
      externalIds.push(value);
    }

    this.logErrors('DB external_id validation', errors);
    return { externalIds, result: { errors } };
  }

  public validateDbRowsForCreatedUtc(
    rawRows: Array<unknown>
  ): { items: GmailDbIngestionRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: GmailDbIngestionRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { external_id?: unknown; created_utc?: unknown };
      if (typeof row.external_id !== 'string' || row.external_id.trim() === '') {
        errors.push('DB row has invalid external_id (expected non-empty string).');
        continue;
      }

      const createdUtcMs = this.parseDateToMs(row.created_utc);
      if (createdUtcMs === null) {
        errors.push(`DB row has invalid created_utc for external_id=${row.external_id}.`);
        continue;
      }

      items.push({
        externalId: row.external_id,
        createdUtcIso: new Date(createdUtcMs).toISOString(),
        createdUtcMs
      });
    }

    this.logErrors('DB created_utc validation', errors);
    return { items, result: { errors } };
  }

  public validateGmailIngestionOrder(
    gmailMessages: GmailMessageDateInfo[],
    dbItemsByExternalId: Map<string, GmailDbIngestionRow>,
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    const matched = gmailMessages
      .map((msg) => {
        const dbItem = dbItemsByExternalId.get(msg.id);
        if (!dbItem) return null;
        if (msg.dateEpochMs === undefined) return null;
        return {
          id: msg.id,
          emailMs: msg.dateEpochMs,
          emailIso: msg.dateIso ?? 'unknown',
          createdMs: dbItem.createdUtcMs,
          createdIso: dbItem.createdUtcIso
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

    if (matched.length < minSamples) {
      errors.push(
        `Not enough Gmail messages with both email date and DB created_utc. Expected at least ${minSamples}, got ${matched.length}.`
      );
      this.logErrors('Gmail ingestion order validation', errors);
      return { errors };
    }

    const sorted = matched.sort((a, b) => a.emailMs - b.emailMs);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.emailMs < next.emailMs && current.createdMs > next.createdMs) {
        errors.push(
          `Ingestion order mismatch: email ${current.id} (${current.emailIso}) has created_utc ${current.createdIso} but later email ${next.id} (${next.emailIso}) has earlier created_utc ${next.createdIso}.`
        );
      }
    }

    this.logErrors('Gmail ingestion order validation', errors);
    return { errors };
  }

  public validateDbRowsForCreatedUtcAndId(
    rawRows: Array<unknown>
  ): { items: GmailDbIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: GmailDbIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { id?: unknown; created_utc?: unknown };
      const id = this.parseIdToNumber(row.id);
      if (id === null) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }

      const createdUtcMs = this.parseDateToMs(row.created_utc);
      if (createdUtcMs === null) {
        errors.push(`DB row has invalid created_utc for id=${row.id}.`);
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
    items: GmailDbIngestionOrderRow[],
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

      if (current.createdUtcMs < next.createdUtcMs && current.id > next.id) {
        errors.push(
          `Order mismatch: created_utc ${current.createdUtcIso} (id=${current.id}) is earlier than ${next.createdUtcIso} (id=${next.id}), but id is larger.`
        );
      }
    }

    this.logErrors('DB created_utc/id order validation', errors);
    return { errors };
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
