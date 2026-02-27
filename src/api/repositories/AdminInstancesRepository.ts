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

  public  async getPreparedJson(): Promise<AdminInstance[]> {
    const response = await this.getAdminInstancesRaw();
    const instances = (await response.json()) as AdminInstance[];

    if (!Array.isArray(instances)) {
      throw new Error('Response should be an array of admin instances');
    }

    return instances.map((instance) => ({
      ...instance,
      id: Number(instance.id),
      enabled: Boolean(instance.enabled),
      totalItemsProcessed: Number(instance.totalItemsProcessed),
      entityResolutionCompleted: Number(instance.entityResolutionCompleted)
    }));
  }
}
