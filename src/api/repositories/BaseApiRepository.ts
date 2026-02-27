import { APIRequestContext, APIResponse } from '@playwright/test';

export abstract class BaseApiRepository {
  protected constructor(
    protected readonly request: APIRequestContext,
    protected readonly apiBaseUrl: string
  ) {}

  protected async get(path: string, headers?: Record<string, string>): Promise<APIResponse> {
    return this.request.get(`${this.apiBaseUrl}${path}`, {
      headers
    });
  }
}
