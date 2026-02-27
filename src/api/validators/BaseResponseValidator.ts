import { APIResponse } from '@playwright/test';

export abstract class BaseResponseValidator {
  public abstract validate(response: APIResponse): Promise<void>;
}
