import { APIResponse, expect } from '@playwright/test';
import { AdminInstance } from '../models/adminInstances';
import { BaseResponseValidator } from './BaseResponseValidator';

export class AdminInstancesValidator extends BaseResponseValidator {
  public async validate(response: APIResponse): Promise<void> {
    console.info('='.repeat(80));
    console.info('🔎 Validation started: GET /admin/instances');

    const status = response.status();
    console.info(`➡️ HTTP status received: ${status}`);
    expect(status, 'GET /admin/instances should return 200').toBe(200);

    const instances = (await response.json()) as AdminInstance[];
    expect(Array.isArray(instances), 'Response should be an array').toBeTruthy();

    console.info(`📦 Instances found: ${instances.length}`);

    for (const [index, instance] of instances.entries()) {
      console.info(
        `• Instance #${index + 1}: id=${instance.id}, tenantId="${instance.tenantId}", connectorId="${instance.connectorId}", displayName="${instance.displayName}", enabled=${instance.enabled}, status="${instance.status}"`
      );

      expect(typeof instance.id, 'id should be number').toBe('number');
      expect(typeof instance.tenantId, 'tenantId should be string').toBe('string');
      expect(typeof instance.connectorId, 'connectorId should be string').toBe('string');
      expect(typeof instance.displayName, 'displayName should be string').toBe('string');
      expect(typeof instance.enabled, 'enabled should be boolean').toBe('boolean');
      expect(typeof instance.settingsJson, 'settingsJson should be string').toBe('string');
      expect(typeof instance.status, 'status should be string').toBe('string');
      expect(
        instance.error === null || typeof instance.error === 'string',
        'error should be null or string'
      ).toBeTruthy();
      expect(typeof instance.createdUtc, 'createdUtc should be string').toBe('string');
      expect(typeof instance.updatedUtc, 'updatedUtc should be string').toBe('string');
      expect(typeof instance.totalItemsProcessed, 'totalItemsProcessed should be number').toBe('number');
      expect(
        instance.lastSyncUtc === null || typeof instance.lastSyncUtc === 'string',
        'lastSyncUtc should be null or string'
      ).toBeTruthy();
      expect(
        instance.syncPhase === null || typeof instance.syncPhase === 'string',
        'syncPhase should be null or string'
      ).toBeTruthy();
      expect(
        typeof instance.entityResolutionCompleted,
        'entityResolutionCompleted should be number'
      ).toBe('number');
    }

    console.info('✅ Validation completed successfully: all instances match expected schema.');
    console.info('='.repeat(80));
  }
}
