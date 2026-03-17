import { ValidationResult } from './ValidationResult';

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
