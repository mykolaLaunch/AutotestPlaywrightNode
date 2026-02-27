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
}
