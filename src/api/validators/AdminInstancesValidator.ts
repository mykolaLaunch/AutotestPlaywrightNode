import { APIResponse } from '@playwright/test';
import { AdminInstance } from '../models/adminInstances';
import { BaseResponseValidator } from './BaseResponseValidator';
import { ValidationResult } from './ValidationResult';

export class AdminInstancesValidator extends BaseResponseValidator {
  public async validate(response: APIResponse): Promise<ValidationResult> {
    console.info('.'.repeat(80));
    console.info('Validation started: GET /admin/instances');

    const errors: string[] = [];
    const status = response.status();
    console.info(`HTTP status received: ${status}`);
    if (status !== 200) {
      errors.push(`GET /admin/instances should return 200, got ${status}.`);
    }

    const prepared = await this.getPreparedInstances(response);
    errors.push(...prepared.errors);
    const instances = prepared.instances;
    console.info(`Instances found: ${instances.length}`);

    if (instances.length === 0) {
      errors.push('Prepared admin instances should not be empty.');
    }

    for (const [index, instance] of instances.entries()) {
      console.info(
        `Instance #${index + 1}: id=${instance.id}, tenantId="${instance.tenantId}", connectorId="${instance.connectorId}", displayName="${instance.displayName}", enabled=${instance.enabled}, status="${instance.status}"`
      );

      if (typeof instance.id !== 'number') errors.push('id should be number');
      if (typeof instance.tenantId !== 'string') errors.push('tenantId should be string');
      if (typeof instance.connectorId !== 'string') errors.push('connectorId should be string');
      if (typeof instance.displayName !== 'string') errors.push('displayName should be string');
      if (typeof instance.enabled !== 'boolean') errors.push('enabled should be boolean');
      if (typeof instance.settingsJson !== 'string') errors.push('settingsJson should be string');
      if (typeof instance.status !== 'string') errors.push('status should be string');
      if (!(instance.error === null || typeof instance.error === 'string')) {
        errors.push('error should be null or string');
      }
      if (typeof instance.createdUtc !== 'string') errors.push('createdUtc should be string');
      if (typeof instance.updatedUtc !== 'string') errors.push('updatedUtc should be string');
      if (typeof instance.totalItemsProcessed !== 'number') {
        errors.push('totalItemsProcessed should be number');
      }
      if (!(instance.lastSyncUtc === null || typeof instance.lastSyncUtc === 'string')) {
        errors.push('lastSyncUtc should be null or string');
      }
      if (!(instance.syncPhase === null || typeof instance.syncPhase === 'string')) {
        errors.push('syncPhase should be null or string');
      }
      if (typeof instance.entityResolutionCompleted !== 'number') {
        errors.push('entityResolutionCompleted should be number');
      }
    }

    this.logErrors('Admin instances validation', errors);
    console.info('.'.repeat(80));
    return { errors };
  }

  /**
   * Verifies that a connector exists and has the expected totalItemsProcessed value.
   */
  public checkConnectorItems(
    instances: AdminInstance[],
    connectorId: string,
    expectedTotalItemsProcessed: number
  ): ValidationResult {
    const errors: string[] = [];

    console.info(
      `Checking connector "${connectorId}" for expected totalItemsProcessed = ${expectedTotalItemsProcessed}`
    );

    const foundInstance = instances.find((instance) => instance.connectorId === connectorId);

    if (!foundInstance) {
      const message = `Connector "${connectorId}" not found in response`;
      console.error(message);
      errors.push(message);
    } else {
      console.info(
        `Found connector "${connectorId}" with totalItemsProcessed = ${foundInstance.totalItemsProcessed}`
      );

      if (foundInstance.totalItemsProcessed !== expectedTotalItemsProcessed) {
        const message = `Mismatch for connector "${connectorId}": expected ${expectedTotalItemsProcessed}, got ${foundInstance.totalItemsProcessed}`;
        console.error(message);
        errors.push(message);
      }
    }

    if (errors.length > 0) {
      return { errors };
    }

    console.info(`Connector ${connectorId} has expected items count.`);
    return { errors };
  }

  private async getPreparedInstances(
    response: APIResponse
  ): Promise<{ instances: AdminInstance[]; errors: string[] }> {
    const errors: string[] = [];
    let payload: AdminInstance[];

    try {
      payload = (await response.json()) as AdminInstance[];
    } catch (err) {
      errors.push(
        `Failed to parse admin instances JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instances: [], errors };
    }

    if (!Array.isArray(payload)) {
      errors.push('Response should be an array of admin instances');
      return { instances: [], errors };
    }

    const instances = payload.map((instance) => ({
      ...instance,
      id: Number(instance.id),
      enabled: Boolean(instance.enabled),
      totalItemsProcessed: Number(instance.totalItemsProcessed),
      entityResolutionCompleted: Number(instance.entityResolutionCompleted)
    }));

    return { instances, errors };
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
