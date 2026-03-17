export interface ValidationResult {
  errors: string[];
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  return {
    errors: results.flatMap((result) => result.errors)
  };
}
