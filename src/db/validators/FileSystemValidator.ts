import path from 'path';
import { RawItemRow } from '../repositories/RawItemRepository';
import { FileDepthMap } from '../../repositories/FileTreeRepository';

export type FileSystemRule = {
  allowed_extensions?: string[];
  deep?: number;
};

export type FileSystemValidationResult = {
  errors: number;
};

export type FileDepthLoadOrderValidationResult = {
  errors: number;
  checkedPairs: number;
  violations: number;
  skippedItems: number;
};

export type FileSystemUniquenessValidationResult = {
  errors: number;
  totalFiles: number;
  totalDbRows: number;
  uniqueDbPaths: number;
  missing: number;
  duplicates: number;
  extra: number;
  invalid: number;
};

export class FileSystemValidator {
  public validate(
    rawItems: RawItemRow[],
    fileDepthMap: FileDepthMap,
    rule?: FileSystemRule,
    rootDir: string = 'TestFilesDirectory'
  ): FileSystemValidationResult {
    const resolvedRoot = path.resolve(rootDir);
    const allowedExts = this.normalizeExtensions(rule?.allowed_extensions);
    const maxDepth = typeof rule?.deep === 'number' ? rule.deep : null;
    let errors = 0;

    console.info('File system validation started.');
    if (allowedExts) {
      console.info(`Allowed extensions: ${Array.from(allowedExts).join(', ')}`);
    } else {
      console.info('Allowed extensions: any');
    }
    if (maxDepth !== null) {
      console.info(`Max depth: ${maxDepth}`);
    } else {
      console.info('Max depth: unlimited');
    }

    const dbPaths = new Set<string>();
    for (const [index, row] of rawItems.entries()) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        errors += 1;
        console.error(
          `Invalid external_id at DB row #${index + 1}: expected non-empty string, got ${typeof externalId}`
        );
        continue;
      }

      if (dbPaths.has(externalId)) {
        errors += 1;
        console.error(`Duplicate external_id in DB: ${externalId}`);
        continue;
      }

      dbPaths.add(externalId);
    }

    for (const [filePath, depth] of Object.entries(fileDepthMap)) {
      const allowed = this.isAllowed(filePath, depth, allowedExts, maxDepth);

      if (allowed) {
        if (!dbPaths.has(filePath)) {
          errors += 1;
          console.error(`Missing DB item for file: ${filePath}`);
        }
      } else {
        if (dbPaths.has(filePath)) {
          errors += 1;
          console.error(`DB contains disallowed file: ${filePath}`);
        }
      }
    }

    for (const dbPath of dbPaths) {
      const inFs = Object.prototype.hasOwnProperty.call(fileDepthMap, dbPath);
      if (!inFs) {
        errors += 1;
        console.error(`DB contains extra file not in filesystem: ${dbPath}`);
      }

      if (allowedExts || maxDepth !== null) {
        const depth = this.getDepthFromPath(dbPath, resolvedRoot);
        if (depth === null) {
          errors += 1;
          console.error(`DB path is outside root directory: ${dbPath}`);
          continue;
        }

        if (!this.isAllowed(dbPath, depth, allowedExts, maxDepth)) {
          errors += 1;
          console.error(`DB path violates rule: ${dbPath}`);
        }
      }
    }

    console.info(`File system validation finished with ${errors} error(s).`);
    return { errors };
  }

  /**
   * Validates that every file in the file tree exists in DB exactly once,
   * and there are no duplicate or extra DB entries.
   */
  public validateUniqueLoad(
    rawItems: RawItemRow[],
    fileDepthMap: FileDepthMap,
    rootDir: string = 'TestFilesDirectory'
  ): FileSystemUniquenessValidationResult {
    const resolvedRoot = path.resolve(rootDir);
    const dbCounts = new Map<string, number>();
    let errors = 0;
    let missing = 0;
    let duplicates = 0;
    let extra = 0;
    let invalid = 0;
    const duplicatePaths = new Set<string>();

    console.info('File system uniqueness validation started.');

    for (const [index, row] of rawItems.entries()) {
      const externalId = (row as { external_id?: unknown }).external_id;
      if (typeof externalId !== 'string' || externalId.trim() === '') {
        errors += 1;
        invalid += 1;
        console.error(
          `Invalid external_id at DB row #${index + 1}: expected non-empty string, got ${typeof externalId}`
        );
        continue;
      }

      const nextCount = (dbCounts.get(externalId) ?? 0) + 1;
      dbCounts.set(externalId, nextCount);
    }

    for (const [dbPath, count] of dbCounts.entries()) {
      if (count > 1) {
        errors += 1;
        duplicates += 1;
        duplicatePaths.add(dbPath);
        console.error(`Duplicate external_id in DB: ${dbPath} (count=${count})`);
      }

      if (!Object.prototype.hasOwnProperty.call(fileDepthMap, dbPath)) {
        errors += 1;
        extra += 1;
        console.error(`DB contains extra file not in filesystem: ${dbPath}`);
      }

      const relative = path.relative(resolvedRoot, dbPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        errors += 1;
        console.error(`DB path is outside root directory: ${dbPath}`);
      }
    }

    for (const filePath of Object.keys(fileDepthMap)) {
      if (!dbCounts.has(filePath)) {
        errors += 1;
        missing += 1;
        console.error(`Missing DB item for file: ${filePath}`);
        continue;
      }

      const count = dbCounts.get(filePath) ?? 0;
      if (count !== 1 && !duplicatePaths.has(filePath)) {
        errors += 1;
        duplicates += 1;
        console.error(`File not loaded exactly once: ${filePath} (count=${count})`);
      }
    }

    console.info(
      `File system uniqueness validation finished: errors=${errors}, missing=${missing}, duplicates=${duplicates}, extra=${extra}, invalid=${invalid}`
    );

    return {
      errors,
      totalFiles: Object.keys(fileDepthMap).length,
      totalDbRows: rawItems.length,
      uniqueDbPaths: dbCounts.size,
      missing,
      duplicates,
      extra,
      invalid
    };
  }

  /**
   * Validates that files from shallower folders were loaded earlier than files from deeper folders.
   * Uses `created_utc` from DB rows and accumulates all mismatches without throwing on first error.
   */
  public validateDepthLoadOrder(
    rawItems: RawItemRow[],
    fileDepthMap: FileDepthMap
  ): FileDepthLoadOrderValidationResult {
    let errors = 0;
    let checkedPairs = 0;
    let violations = 0;
    let skippedItems = 0;
    const maxViolationLogs = 50;
    let violationLogs = 0;

    type ParsedItem = {
      externalId: string;
      depth: number;
      createdUtcMs: number;
    };

    const parsedItems: ParsedItem[] = [];

    console.info('Depth load order validation started.');

    for (const [index, row] of rawItems.entries()) {
      const externalId = (row as { external_id?: unknown }).external_id;
      const createdUtc = (row as { created_utc?: unknown }).created_utc;

      if (typeof externalId !== 'string' || externalId.trim() === '') {
        errors += 1;
        skippedItems += 1;
        console.error(
          `Invalid external_id at DB row #${index + 1}: expected non-empty string, got ${typeof externalId}`
        );
        continue;
      }

      const depth = fileDepthMap[externalId];
      if (typeof depth !== 'number') {
        errors += 1;
        skippedItems += 1;
        console.error(`No file depth found for external_id: ${externalId}`);
        continue;
      }

      const createdUtcMs = this.parseCreatedUtcToMs(createdUtc);
      if (createdUtcMs === null) {
        errors += 1;
        skippedItems += 1;
        console.error(
          `Invalid created_utc for external_id "${externalId}": expected Date, ISO string, or "YYYY-MM-DD HH:mm:ss.SSS +HHMM", got "${String(createdUtc)}"`
        );
        continue;
      }

      parsedItems.push({ externalId, depth, createdUtcMs });
    }

    for (let i = 0; i < parsedItems.length; i += 1) {
      for (let j = i + 1; j < parsedItems.length; j += 1) {
        const a = parsedItems[i];
        const b = parsedItems[j];

        if (a.depth === b.depth) {
          continue;
        }

        checkedPairs += 1;

        const shallower = a.depth < b.depth ? a : b;
        const deeper = a.depth < b.depth ? b : a;

        if (shallower.createdUtcMs > deeper.createdUtcMs) {
          errors += 1;
          violations += 1;
          if (violationLogs < maxViolationLogs) {
            console.error(
              `Depth order violation: shallower file "${shallower.externalId}" (depth=${shallower.depth}, created_utc=${new Date(shallower.createdUtcMs).toISOString()}) is later than deeper file "${deeper.externalId}" (depth=${deeper.depth}, created_utc=${new Date(deeper.createdUtcMs).toISOString()})`
            );
            violationLogs += 1;
          }
        }
      }
    }

    if (violations > violationLogs) {
      console.error(`Additional depth order violations not printed: ${violations - violationLogs}`);
    }

    console.info(
      `Depth load order validation finished: errors=${errors}, violations=${violations}, checkedPairs=${checkedPairs}, skippedItems=${skippedItems}`
    );

    return { errors, checkedPairs, violations, skippedItems };
  }

  private isAllowed(
    filePath: string,
    depth: number,
    allowedExts: Set<string> | null,
    maxDepth: number | null
  ): boolean {
    if (allowedExts && !allowedExts.has(this.getExtension(filePath))) {
      return false;
    }
    if (maxDepth !== null && depth > maxDepth) {
      return false;
    }
    return true;
  }

  private normalizeExtensions(extensions?: string[]): Set<string> | null {
    if (!extensions || extensions.length === 0) return null;
    const normalized = extensions.map((ext) => {
      const trimmed = ext.trim();
      return trimmed.startsWith('.') ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
    });
    return new Set(normalized);
  }

  private getExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase();
  }

  private getDepthFromPath(filePath: string, rootDir: string): number | null {
    const relative = path.relative(rootDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    const segments = relative.split(path.sep);
    return Math.max(1, segments.length);
  }

  private parseCreatedUtcToMs(value: unknown): number | null {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isNaN(timestamp) ? null : timestamp;
    }

    if (typeof value !== 'string') return null;
    const input = value.trim();

    // First, accept native Date.parse-compatible strings (e.g. ISO 8601).
    const directParsed = Date.parse(input);
    if (!Number.isNaN(directParsed)) {
      return directParsed;
    }

    // Fallback for SQL-style "YYYY-MM-DD HH:mm:ss.SSS +HHMM".
    const match = input.match(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))? ([+-]\d{2})(\d{2})$/
    );
    if (!match) return null;

    const [, datePart, timePart, fractionPart = '', tzHour, tzMinute] = match;
    const milliPart = (fractionPart + '000').slice(0, 3);
    const iso = `${datePart}T${timePart}.${milliPart}${tzHour}:${tzMinute}`;
    const timestamp = Date.parse(iso);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
}
