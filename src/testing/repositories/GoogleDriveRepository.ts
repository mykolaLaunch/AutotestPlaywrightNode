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
  modifiedTimeIso: string | null;
  parentIds: string[];
  mimeType: string;
  owners: string[];
  driveId?: string;
}

export interface GoogleDriveCreateFileResult {
  id?: string;
  errors: string[];
}

export interface GoogleDriveDeleteFileResult {
  errors: string[];
}

export interface GoogleDriveFolderFilterOptions {
  includeMimeTypes?: string[];
  excludeMimeTypes?: string[];
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
          fields: 'nextPageToken, files(id, name, modifiedTime, parents, mimeType, owners(displayName,emailAddress), driveId)'
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
            modifiedTimeIso: this.formatDateTimeIso(file.modifiedTime ?? null),
            parentIds: file.parents ?? [],
            mimeType: file.mimeType ?? 'unknown',
            owners: this.formatOwners(file.owners),
            driveId: file.driveId ?? undefined
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

  public async getFileIdsByFolderIds(
    folderIds: string[],
    userId: string = 'me',
    options: GoogleDriveFolderFilterOptions = {}
  ): Promise<GoogleDriveFileIdsResult> {
    const errors: string[] = [];
    const normalizedFolderIds = folderIds
      .filter((id) => typeof id === 'string' && id.trim() !== '')
      .map((id) => (id === 'myDrive' ? 'root' : id.trim()));

    if (normalizedFolderIds.length === 0) {
      errors.push('No Google Drive folderIds provided for config-based coverage.');
      return { ids: [], errors, fileDetailsById: {} };
    }

    const includeMimeTypes = Array.isArray(options.includeMimeTypes)
      ? options.includeMimeTypes.filter((type) => typeof type === 'string' && type.trim() !== '')
      : [];
    const excludeMimeTypes = Array.isArray(options.excludeMimeTypes)
      ? options.excludeMimeTypes.filter((type) => typeof type === 'string' && type.trim() !== '')
      : [];
    const applyExtensionFilter = includeMimeTypes.length === 0;

    try {
      const auth = await this.buildAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      const ids: string[] = [];
      const fileDetailsById: Record<string, GoogleDriveFileDetail> = {};

      const queue = [...new Set(normalizedFolderIds)];
      const visitedFolders = new Set<string>();

      while (queue.length > 0) {
        const parentId = queue.shift() as string;
        if (visitedFolders.has(parentId)) {
          continue;
        }
        visitedFolders.add(parentId);

        let pageToken: string | undefined;
        do {
          const res = await drive.files.list({
            pageToken,
            pageSize: 1000,
            q: `'${parentId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, modifiedTime, parents, mimeType, owners(displayName,emailAddress), driveId)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
          });

          const files = res.data.files ?? [];
          for (const file of files) {
            if (!file.id || !file.name) {
              continue;
            }

            if (file.mimeType === 'application/vnd.google-apps.folder') {
              if (!visitedFolders.has(file.id)) {
                queue.push(file.id);
              }
              continue;
            }

            if (includeMimeTypes.length > 0 && file.mimeType && !includeMimeTypes.includes(file.mimeType)) {
              continue;
            }
            if (excludeMimeTypes.length > 0 && file.mimeType && excludeMimeTypes.includes(file.mimeType)) {
              continue;
            }

            if (applyExtensionFilter) {
              const ext = this.getExtension(file.name);
              if (!ext || !this.allowedExtensions.has(ext)) {
                continue;
              }
            }

            ids.push(file.id);
            fileDetailsById[file.id] = {
              id: file.id,
              name: file.name,
              modifiedDate: this.formatDate(file.modifiedTime ?? null),
              modifiedTimeIso: this.formatDateTimeIso(file.modifiedTime ?? null),
              parentIds: file.parents ?? [],
              mimeType: file.mimeType ?? 'unknown',
              owners: this.formatOwners(file.owners),
              driveId: file.driveId ?? undefined
            };
          }

          pageToken = res.data.nextPageToken ?? undefined;
        } while (pageToken);
      }

      return { ids, errors, fileDetailsById };
    } catch (err) {
      errors.push(
        `Failed to fetch Google Drive file ids by folderIds: ${err instanceof Error ? err.message : String(err)}`
      );
      return { ids: [], errors, fileDetailsById: {} };
    }
  }

  public async getFileDetailsByIds(
    fileIds: string[],
    userId: string = 'me'
  ): Promise<{ detailsById: Record<string, GoogleDriveFileDetail>; errors: string[] }> {
    const errors: string[] = [];
    const detailsById: Record<string, GoogleDriveFileDetail> = {};

    try {
      const auth = await this.buildAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      for (const fileId of fileIds) {
        try {
          const res = await drive.files.get({
            fileId,
            fields: 'id, name, modifiedTime, parents, mimeType, owners(displayName,emailAddress), driveId'
          });

          const file = res.data;
          if (!file.id || !file.name) {
            errors.push(`Google Drive file lookup returned missing id/name for ${fileId}.`);
            continue;
          }

          detailsById[file.id] = {
            id: file.id,
            name: file.name,
            modifiedDate: this.formatDate(file.modifiedTime ?? null),
            modifiedTimeIso: this.formatDateTimeIso(file.modifiedTime ?? null),
            parentIds: file.parents ?? [],
            mimeType: file.mimeType ?? 'unknown',
            owners: this.formatOwners(file.owners),
            driveId: file.driveId ?? undefined
          };
        } catch (err) {
          errors.push(
            `Failed to fetch Google Drive file ${fileId}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } catch (err) {
      errors.push(
        `Failed to initialize Google Drive client: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { detailsById, errors };
  }

  public async createTextFile(
    name: string,
    content: string,
    parentId?: string,
    userId: string = 'me'
  ): Promise<GoogleDriveCreateFileResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const drive = google.drive({ version: 'v3', auth });

      const requestBody: {
        name: string;
        parents?: string[];
      } = { name };

      if (parentId) {
        requestBody.parents = [parentId];
      }

      const res = await drive.files.create({
        requestBody,
        media: {
          mimeType: 'text/plain',
          body: content
        },
        fields: 'id'
      });

      const fileId = res.data.id ?? undefined;
      if (!fileId) {
        errors.push('Google Drive create did not return file id.');
      }

      return { id: fileId, errors };
    } catch (err) {
      errors.push(
        `Failed to create Google Drive file: ${err instanceof Error ? err.message : String(err)}`
      );
      return { id: undefined, errors };
    }
  }

  public async deleteFile(fileId: string, userId: string = 'me'): Promise<GoogleDriveDeleteFileResult> {
    const errors: string[] = [];
    try {
      const auth = await this.buildAuthClient();
      const drive = google.drive({ version: 'v3', auth });
      await drive.files.delete({ fileId });
      return { errors };
    } catch (err) {
      errors.push(
        `Failed to delete Google Drive file ${fileId}: ${err instanceof Error ? err.message : String(err)}`
      );
      return { errors };
    }
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

  private formatDateTimeIso(raw?: string | null): string | null {
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return raw;
  }

  private formatOwners(
    owners?: Array<{ displayName?: string | null; emailAddress?: string | null }> | null
  ): string[] {
    if (!owners || owners.length === 0) {
      return [];
    }
    return owners.map((owner) => {
      const email = owner.emailAddress?.trim();
      const name = owner.displayName?.trim();
      if (email && name && email !== name) {
        return `${name} <${email}>`;
      }
      return email || name || 'unknown';
    });
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
