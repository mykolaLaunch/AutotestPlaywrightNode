import { ValidationResult } from './ValidationResult';

export interface CalendarDbIngestionOrderRow {
  id: number;
  updatedUtcIso: string;
  updatedUtcMs: number;
}

export interface CalendarUpdatedOrderRow {
  id: number;
  externalId: string;
  updatedTimeIso: string;
  updatedTimeMs: number;
  summary?: string;
}

export interface CalendarNeo4jUpdatedOrderRow {
  rawVersionId: number;
  externalId: string;
  updatedTimeIso: string;
  updatedTimeMs: number;
  summary?: string;
}

export class GoogleCalendarExternalIdValidator {
  public validateEventIdsPresentInDb(eventIds: string[], dbExternalIds: string[]): ValidationResult {
    const errors: string[] = [];

    if (eventIds.length === 0) {
      errors.push('No Google Calendar event ids were returned.');
    }

    const dbSet = new Set(dbExternalIds);
    const missing: string[] = [];

    for (const id of eventIds) {
      if (!dbSet.has(id)) {
        missing.push(id);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 50);
      errors.push(
        `DB is missing ${missing.length} Google Calendar external_id(s). First ${preview.length}: ${preview.join(', ')}`
      );
    }

    this.logErrors('Google Calendar external_id validation', errors);
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

  public validateDbRowsForUpdatedUtcAndId(
    rawRows: Array<unknown>
  ): { items: CalendarDbIngestionOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: CalendarDbIngestionOrderRow[] = [];

    for (const raw of rawRows) {
      const row = raw as { id?: unknown; updated_utc?: unknown };
      const id = this.parseIdToNumber(row.id);
      if (id === null) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }

      const updatedUtcMs = this.parseDateToMs(row.updated_utc);
      if (updatedUtcMs === null) {
        errors.push(`DB row has invalid updated_utc for id=${id}.`);
        continue;
      }

      items.push({
        id,
        updatedUtcIso: new Date(updatedUtcMs).toISOString(),
        updatedUtcMs
      });
    }

    this.logErrors('DB updated_utc + id validation', errors);
    return { items, result: { errors } };
  }

  public validateUpdatedUtcIdOrder(
    items: CalendarDbIngestionOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough DB rows to validate updated_utc/id order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('DB updated_utc/id order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.updatedUtcMs - b.updatedUtcMs || a.id - b.id);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.updatedUtcMs < next.updatedUtcMs && current.id > next.id) {
        errors.push(
          `Order mismatch: updated_utc ${current.updatedUtcIso} (id=${current.id}) is earlier than ${next.updatedUtcIso} (id=${next.id}), but id is larger.`
        );
      }
    }

    this.logErrors('DB updated_utc/id order validation', errors);
    return { errors };
  }

  public buildCalendarUpdatedOrderItems(
    dbRows: Array<unknown>,
    calendarDetailsById: Record<
      string,
      { updatedIso: string | null; summary?: string | null }
    >
  ): { items: CalendarUpdatedOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: CalendarUpdatedOrderRow[] = [];

    for (const raw of dbRows) {
      const row = raw as { id?: unknown; external_id?: unknown };
      const id = this.parseIdToNumber(row.id);
      if (id === null) {
        errors.push('DB row has invalid id (expected finite number).');
        continue;
      }
      if (typeof row.external_id !== 'string' || row.external_id.trim() === '') {
        errors.push(`DB row has invalid external_id for id=${id}.`);
        continue;
      }

      const detail = calendarDetailsById[row.external_id];
      if (!detail) {
        errors.push(`Calendar details missing for external_id=${row.external_id}.`);
        continue;
      }

      const updatedMs = this.parseDateToMs(detail.updatedIso);
      if (updatedMs === null) {
        errors.push(`Calendar detail has invalid updated time for external_id=${row.external_id}.`);
        continue;
      }

      items.push({
        id,
        externalId: row.external_id,
        updatedTimeIso: new Date(updatedMs).toISOString(),
        updatedTimeMs: updatedMs,
        summary: detail.summary ?? undefined
      });
    }

    this.logErrors('Calendar updated time + DB id validation', errors);
    return { items, result: { errors } };
  }

  public validateCalendarUpdatedTimeIdOrder(
    items: CalendarUpdatedOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough items to validate Calendar updatedTime/DB id order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('Calendar updatedTime/DB id order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.updatedTimeMs - b.updatedTimeMs || a.id - b.id);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.updatedTimeMs < next.updatedTimeMs && current.id < next.id) {
        errors.push(
          `Order mismatch: updatedTime ${current.updatedTimeIso} (id=${current.id}, external_id=${current.externalId}) is earlier than ${next.updatedTimeIso} (id=${next.id}, external_id=${next.externalId}), but id is smaller.`
        );
      }
    }

    this.logErrors('Calendar updatedTime/DB id order validation', errors);
    return { errors };
  }

  public buildCalendarUpdatedOrderItemsFromNeo4j(
    neo4jRows: Array<unknown>,
    calendarDetailsById: Record<
      string,
      { updatedIso: string | null; summary?: string | null }
    >
  ): { items: CalendarNeo4jUpdatedOrderRow[]; result: ValidationResult } {
    const errors: string[] = [];
    const items: CalendarNeo4jUpdatedOrderRow[] = [];

    for (const raw of neo4jRows) {
      const row = raw as { rawVersionId?: unknown; externalId?: unknown };
      const rawVersionId = this.parseIdToNumber(row.rawVersionId);
      if (rawVersionId === null) {
        errors.push('Neo4j row has invalid rawVersionId (expected finite number).');
        continue;
      }
      if (typeof row.externalId !== 'string' || row.externalId.trim() === '') {
        errors.push(`Neo4j row has invalid externalId for rawVersionId=${rawVersionId}.`);
        continue;
      }

      const detail = calendarDetailsById[row.externalId];
      if (!detail) {
        errors.push(`Calendar details missing for externalId=${row.externalId}.`);
        continue;
      }

      const updatedMs = this.parseDateToMs(detail.updatedIso);
      if (updatedMs === null) {
        errors.push(`Calendar detail has invalid updated time for externalId=${row.externalId}.`);
        continue;
      }

      items.push({
        rawVersionId,
        externalId: row.externalId,
        updatedTimeIso: new Date(updatedMs).toISOString(),
        updatedTimeMs: updatedMs,
        summary: detail.summary ?? undefined
      });
    }

    this.logErrors('Calendar updated time + Neo4j rawVersionId validation', errors);
    return { items, result: { errors } };
  }

  public validateCalendarUpdatedTimeRawVersionIdOrder(
    items: CalendarNeo4jUpdatedOrderRow[],
    minSamples: number = 5
  ): ValidationResult {
    const errors: string[] = [];

    if (items.length < minSamples) {
      errors.push(
        `Not enough items to validate Calendar updatedTime/Neo4j rawVersionId order. Expected at least ${minSamples}, got ${items.length}.`
      );
      this.logErrors('Calendar updatedTime/Neo4j rawVersionId order validation', errors);
      return { errors };
    }

    const sorted = items
      .slice()
      .sort((a, b) => a.updatedTimeMs - b.updatedTimeMs || a.rawVersionId - b.rawVersionId);

    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.updatedTimeMs < next.updatedTimeMs && current.rawVersionId < next.rawVersionId) {
        errors.push(
          `Order mismatch: updatedTime ${current.updatedTimeIso} (rawVersionId=${current.rawVersionId}, externalId=${current.externalId}) is earlier than ${next.updatedTimeIso} (rawVersionId=${next.rawVersionId}, externalId=${next.externalId}), but rawVersionId is smaller.`
        );
      }
    }

    this.logErrors('Calendar updatedTime/Neo4j rawVersionId order validation', errors);
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
    if (value && typeof value === 'object') {
      const candidate = value as { toNumber?: () => number; low?: unknown; high?: unknown };
      if (typeof candidate.toNumber === 'function') {
        const parsed = candidate.toNumber();
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
      if (typeof candidate.low === 'number' && typeof candidate.high === 'number') {
        return candidate.high * 2 ** 32 + candidate.low;
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
