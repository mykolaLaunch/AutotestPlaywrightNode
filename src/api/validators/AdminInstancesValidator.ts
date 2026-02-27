import { APIResponse, expect } from '@playwright/test';
import { AdminInstance } from '../models/adminInstances';
import { AdminInstancesRepository } from '../repositories/AdminInstancesRepository';
import { BaseResponseValidator } from './BaseResponseValidator';

export class AdminInstancesValidator extends BaseResponseValidator {
  public async validate(response: APIResponse): Promise<void> {
    console.info('.'.repeat(80));
    console.info('🔎 Validation started: GET /admin/instances');

    const status = response.status();
    console.info(`➡️ HTTP status received: ${status}`);
    expect(status, 'GET /admin/instances should return 200').toBe(200);
    expect(response.status(), 'GET /admin/instances should return 200').toBe(200);

    const instances = await AdminInstancesRepository.getPreparedJson(response);

    console.info(`📦 Instances found: ${instances.length}`);

    for (const [index, instance] of instances.entries()) {
      console.info(
          `• Instance #${index + 1}: id=${instance.id}, tenantId="${instance.tenantId}", connectorId="${instance.connectorId}", displayName="${instance.displayName}", enabled=${instance.enabled}, status="${instance.status}"`
      );

      for (const instance of instances) {
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
      console.info('.'.repeat(80));
    }
  }

  /**
   * Проверяет, что среди экземпляров есть нужный connectorId и у него заданное количество обработанных элементов.
   * Проверки выполняются без expect, но все шаги логируются. При несовпадениях накапливаются ошибки и выбрасывается исключение.
   */
  public checkConnectorItems(
    instances: AdminInstance[],
    connectorId: string,
    expectedTotalItemsProcessed: number
  ): void {
    const errors: string[] = [];

    console.info(
      `\u2139\uFE0F Checking connector "${connectorId}" for expected totalItemsProcessed = ${expectedTotalItemsProcessed}`
    );

    const foundInstance = instances.find((instance) => instance.connectorId === connectorId);

    if (!foundInstance) {
      const message = `Connector "${connectorId}" not found in response`;
      console.error(message);
      console.info(
        `\u274C Checked connector - ${connectorId}, expected items qty = ${expectedTotalItemsProcessed}, present items - not found`
      );
      errors.push(message);
    } else {
      console.info(
        `\u2705 Found connector "${connectorId}" with totalItemsProcessed = ${foundInstance.totalItemsProcessed}`
      );

      if (foundInstance.totalItemsProcessed !== expectedTotalItemsProcessed) {
        const message = `Mismatch for connector "${connectorId}": expected ${expectedTotalItemsProcessed}, got ${foundInstance.totalItemsProcessed}`;
        console.error(message);
        errors.push(message);
      } else {
        console.info(
          `\u2705 Checked connector - ${connectorId}, expected items qty = ${expectedTotalItemsProcessed}, present items - ${foundInstance.totalItemsProcessed}`
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(`Connector items validation failed: ${errors.join('; ')}`);
    } else {
      console.info(
          `Connector   ${connectorId} has expected items count.`
      );
    }
  }
}
