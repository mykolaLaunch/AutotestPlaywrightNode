import fs from 'fs';
import path from 'path';

let envLoaded = false;

export function loadEnvOnce(envPath: string = path.resolve(process.cwd(), '.env')): void {
  if (envLoaded) return;

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith(';'))
      .forEach((line) => {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) return;
        const key = line.slice(0, eqIdx).trim();
        const value = line.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = value;
        }
      });
  }

  envLoaded = true;
}
