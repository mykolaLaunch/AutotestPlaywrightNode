import path from 'path';
import { ValidationResult } from './ValidationResult';

export interface FileSystemRootSetting {
  path: string;
}

export class FileSystemConnectorSettingsValidator {
  public parseSettingsJson(
    settingsJson: string | null | undefined
  ): { settings: Record<string, unknown> | null; errors: string[] } {
    const errors: string[] = [];
    if (typeof settingsJson !== 'string' || settingsJson.trim() === '') {
      errors.push('file-system settingsJson is empty.');
      return { settings: null, errors };
    }

    try {
      const parsed = JSON.parse(settingsJson) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('file-system settingsJson must be a JSON object.');
        return { settings: null, errors };
      }
      return { settings: parsed as Record<string, unknown>, errors };
    } catch (err) {
      errors.push(
        `Failed to parse file-system settingsJson: ${err instanceof Error ? err.message : String(err)}`
      );
      return { settings: null, errors };
    }
  }

  public validateAndGetRoots(
    settings: Record<string, unknown>
  ): { roots: FileSystemRootSetting[]; result: ValidationResult } {
    const errors: string[] = [];
    const rawRoots = settings.roots;

    if (!Array.isArray(rawRoots)) {
      errors.push('file-system settingsJson.roots must be an array.');
      return { roots: [], result: { errors } };
    }

    const roots: FileSystemRootSetting[] = [];
    for (let i = 0; i < rawRoots.length; i += 1) {
      const item = rawRoots[i] as { path?: unknown };
      if (!item || typeof item !== 'object') {
        errors.push(`settingsJson.roots[${i}] must be an object.`);
        continue;
      }
      if (typeof item.path !== 'string' || item.path.trim() === '') {
        errors.push(`settingsJson.roots[${i}].path must be a non-empty string.`);
        continue;
      }
      roots.push({ path: item.path });
    }

    return { roots, result: { errors } };
  }

  public addRootPath(
    settings: Record<string, unknown>,
    newRootPath: string
  ): { changed: boolean; updatedSettings: Record<string, unknown>; result: ValidationResult } {
    const rootsResult = this.validateAndGetRoots(settings);
    if (rootsResult.result.errors.length > 0) {
      return {
        changed: false,
        updatedSettings: settings,
        result: rootsResult.result
      };
    }

    const normalizedTarget = this.normalizeFolderPath(newRootPath);
    const rootEntries = (settings.roots as Array<{ path: string }>).map((root) => ({
      ...root,
      path: this.normalizeFolderPath(root.path)
    }));

    const hasTarget = rootEntries.some((root) => root.path.toLowerCase() === normalizedTarget.toLowerCase());
    if (!hasTarget) {
      rootEntries.push({ path: normalizedTarget });
      settings.roots = rootEntries;
      return { changed: true, updatedSettings: settings, result: { errors: [] } };
    }

    settings.roots = rootEntries;
    return { changed: false, updatedSettings: settings, result: { errors: [] } };
  }

  public validateUpdateStatus(status: number): ValidationResult {
    const errors: string[] = [];
    const acceptedStatuses = [200, 204];
    if (!acceptedStatuses.includes(status)) {
      errors.push(`PUT /admin/instances/{id} expected one of 200/204, got ${status}.`);
    }
    return { errors };
  }

  private normalizeFolderPath(folderPath: string): string {
    const resolved = path.resolve(folderPath);
    return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
  }
}
