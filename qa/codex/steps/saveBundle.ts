import { CodexRunContext } from '../types';
import { writeJsonFile } from '../utils/io';

export async function saveBundle(context: CodexRunContext): Promise<void> {
  console.info('Step 4: Writing bundle...');
  await writeJsonFile(context.bundlePath, context.bundle);
  console.info(`Bundle saved: ${context.bundlePath}`);
}
