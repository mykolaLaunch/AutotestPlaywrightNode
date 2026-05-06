import { ValidationResult } from './ValidationResult';

export class AdminConnectorsValidator {
  public validateHealthStatus(status: number): ValidationResult {
    const errors: string[] = [];
    if (status !== 200) {
      errors.push(`/health expected HTTP 200, got ${status}.`);
    }
    return { errors };
  }

  public validateHealthBody(body: string | null): ValidationResult {
    const errors: string[] = [];
    if (typeof body !== 'string') {
      errors.push('/health response body is not readable.');
      return { errors };
    }
    if (body.trim().length === 0) {
      errors.push('/health response body is empty.');
    }
    return { errors };
  }

  public validateDefinitionsStatus(status: number): ValidationResult {
    const errors: string[] = [];
    if (status !== 200) {
      errors.push(`/admin/connectors/definitions expected HTTP 200, got ${status}.`);
    }
    return { errors };
  }

  public validateDefinitionsBody(body: unknown[] | null): ValidationResult {
    const errors: string[] = [];
    if (!Array.isArray(body)) {
      errors.push('/admin/connectors/definitions response is not an array.');
      return { errors };
    }

    if (body.length === 0) {
      errors.push('/admin/connectors/definitions returned empty array.');
      return { errors };
    }

    for (let i = 0; i < body.length; i += 1) {
      const item = body[i] as Record<string, unknown> | null;
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`definitions[${i}] is not an object.`);
        continue;
      }

      const hasConnectorId =
        typeof item.connectorId === 'string' && item.connectorId.trim().length > 0;
      const hasId = typeof item.id === 'string' && item.id.trim().length > 0;
      const hasName =
        (typeof item.name === 'string' && item.name.trim().length > 0) ||
        (typeof item.displayName === 'string' && item.displayName.trim().length > 0);

      if (!hasConnectorId && !hasId) {
        errors.push(`definitions[${i}] does not contain connector id field.`);
      }
      if (!hasName) {
        errors.push(`definitions[${i}] does not contain non-empty name/displayName.`);
      }
    }

    return { errors };
  }

  public validateRescanStatus(status: number): ValidationResult {
    const errors: string[] = [];
    const allowed = new Set([200, 202, 204]);
    if (!allowed.has(status)) {
      errors.push(`/admin/connectors/rescan expected one of 200/202/204, got ${status}.`);
    }
    return { errors };
  }

  public validateUnauthorizedStatus(status: number, endpoint: string): ValidationResult {
    const errors: string[] = [];
    const allowed = new Set([401, 403]);
    if (!allowed.has(status)) {
      errors.push(`${endpoint} expected HTTP 401 or 403 without auth, got ${status}.`);
    }
    return { errors };
  }

  public validateAuthBoundaryStatus(status: number, endpoint: string): ValidationResult {
    const errors: string[] = [];
    const allowed = new Set([200, 401, 403]);
    if (!allowed.has(status)) {
      errors.push(`${endpoint} expected HTTP 200 (open) or 401/403 (protected), got ${status}.`);
    }
    return { errors };
  }
}
