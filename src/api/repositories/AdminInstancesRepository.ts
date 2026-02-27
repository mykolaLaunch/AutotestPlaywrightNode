import { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiRepository } from './BaseApiRepository';

export class AdminInstancesRepository extends BaseApiRepository {
  constructor(request: APIRequestContext, apiBaseUrl: string) {
    super(request, apiBaseUrl);
  }

  public async getAdminInstances(): Promise<APIResponse> {
    return this.get('/admin/instances', {
      accept: 'text/plain'
    });
  }
}
