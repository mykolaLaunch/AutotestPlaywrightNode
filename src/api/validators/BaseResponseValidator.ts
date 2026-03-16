import { APIResponse } from '@playwright/test';
import { ValidationResult } from './ValidationResult';

export abstract class BaseResponseValidator {
  public abstract validate(response: APIResponse): Promise<ValidationResult>;
}
