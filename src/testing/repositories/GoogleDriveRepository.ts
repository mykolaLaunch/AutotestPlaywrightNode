import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { loadEnvOnce } from '../utils/envLoader';

export interface GoogleDriveFileIdsResult {
  ids: string[];
  errors: string[];
  fileDetailsById: Record<string, GoogleDriveFileDetail>;
}

export interface GoogleDriveFileDetail {
  id: string;
  name: string;
  modifiedDate: string;
  parentIds: string[];
}

export class GoogleDriveRepository {
  private readonly tokenPath: string;
  private readonly credentialsPath: string;
  private readonly allowedExtensions: Set<string>;

  constructor(
    tokenPath: string = path.resolve(process.cwd(), 'secrets', 'token.json'),
    credentialsPath: string = path.resolve(process.cwd(), 'secrets', 'google-oauth-client.json'),
    allowedExtensions: string[] = [
      'pdf',
      'doc',
      'docx',
      'xlsx',
      'xls',
      'pptx',
      'ppt',
      'txt',
      'log',
      'csv',
      'json',
      'xml',
      'yml',
      'yaml',
      'html',
      'md'
    ]
  ) {
    this.tokenPath = tokenPath;
    this.credentialsPath = credentialsPath;
    this.allowedExtensions = new Set(allowedExtensions.map((ext) => ext.toLowerCase()));
  }

  public async getAllFileIds(userId: string = 'me'): Promise<GoogleDriveFileIdsResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      const ids: string[] = [];
      const fileDetailsById: Record<string, GoogleDriveFileDetail> = {};
      let pageToken: string | undefined;

      do {
        const res = await drive.files.list({
          pageToken,
          pageSize: 1000,
          q: "trashed = false",
          fields: 'nextPageToken, files(id, name, modifiedTime, parents, mimeType)'
        });

        const files = res.data.files ?? [];
        for (const file of files) {
          if (!file.id || !file.name) {
            continue;
          }
          if (file.mimeType === 'application/vnd.google-apps.folder') {
            continue;
          }

          const ext = this.getExtension(file.name);
          if (!ext || !this.allowedExtensions.has(ext)) {
            continue;
          }

          ids.push(file.id);
          fileDetailsById[file.id] = {
            id: file.id,
            name: file.name,
            modifiedDate: this.formatDate(file.modifiedTime ?? null),
            parentIds: file.parents ?? []
          };
        }

        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);

      return { ids, errors, fileDetailsById };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Drive file ids: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors, fileDetailsById: {} };
    }
  }

  public async resolveParentNames(
    parentIds: string[],
    userId: string = 'me'
  ): Promise<Map<string, string>> {
    const auth = await this.buildAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const nameMap = new Map<string, string>();

    for (const parentId of parentIds) {
      if (nameMap.has(parentId)) {
        continue;
      }
      const res = await drive.files.get({
        fileId: parentId,
        fields: 'id, name'
      });
      if (res.data.id && res.data.name) {
        nameMap.set(res.data.id, res.data.name);
      }
    }

    return nameMap;
  }

  private getExtension(fileName: string): string | undefined {
    const idx = fileName.lastIndexOf('.');
    if (idx === -1 || idx === fileName.length - 1) {
      return undefined;
    }
    return fileName.slice(idx + 1).toLowerCase();
  }

  private formatDate(raw?: string | null): string {
    if (!raw) {
      return 'unknown date';
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return raw;
  }

  private async buildAuthClient() {
    loadEnvOnce();
    const credentials = this.readJsonFile<Record<string, unknown>>(this.credentialsPath);
    const token = this.readJsonFile<Record<string, unknown>>(this.tokenPath);

    const installed = (credentials.installed as {
      client_id?: string;
      client_secret?: string;
      redirect_uris?: string[];
    }) ?? {};

    const clientId = installed.client_id;
    const clientSecret = installed.client_secret;
    const redirectUri = installed.redirect_uris?.[0] ?? 'http://localhost';

    if (!clientId || !clientSecret) {
      throw new Error('OAuth client credentials are missing client_id or client_secret.');
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials(token);
    return auth;
  }

  private readJsonFile<T>(filePath: string): T {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Required file not found: ${resolved}`);
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    return JSON.parse(raw) as T;
  }
}
