import { APIRequestContext, APIResponse } from '@playwright/test';
import { AdminInstance } from '../models/adminInstances';
import { BaseApiRepository } from './BaseApiRepository';

export class AdminInstancesRepository extends BaseApiRepository {
  protected endpoint = '/admin/instances';

  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  public async getAdminInstancesRaw(): Promise<APIResponse> {
    return this.request.get(this.getCompleteUrl(), {
      headers: this.getResponseTypeHeaders(false)
    });
  }

  public async getAdminInstances(): Promise<AdminInstance[]> {
    const response = await this.getAdminInstancesRaw();
    return this.processSuccessResponse<AdminInstance[]>(response);
  }

  public async getPreparedJson(): Promise<AdminInstance[]> {
    const response = await this.getAdminInstancesRaw();
    const parsed = await this.parsePreparedFromResponse(response);
    if (!parsed.instances) {
      throw new Error(parsed.errors.join(' ') || 'Failed to parse admin instances response');
    }
    return parsed.instances;
  }

  public async parsePreparedFromResponse(
    response: APIResponse
  ): Promise<{ instances: AdminInstance[] | null; errors: string[] }> {
    const errors: string[] = [];

    let instances: AdminInstance[];
    try {
      instances = (await this.parseJsonResponse<AdminInstance[]>(response)) as AdminInstance[];
    } catch (err) {
      errors.push(
        `Failed to parse admin instances response JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instances: null, errors };
    }

    if (!Array.isArray(instances)) {
      errors.push('Response should be an array of admin instances');
      return { instances: null, errors };
    }

    const prepared = instances.map((instance) => ({
      ...instance,
      id: Number(instance.id),
      enabled: Boolean(instance.enabled),
      totalItemsProcessed: Number(instance.totalItemsProcessed),
      entityResolutionCompleted: Number(instance.entityResolutionCompleted)
    }));

    return { instances: prepared, errors };
  }
}
