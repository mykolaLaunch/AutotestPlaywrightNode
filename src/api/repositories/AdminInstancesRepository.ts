import { APIRequestContext, APIResponse } from '@playwright/test';
import { AdminInstance } from '../models/adminInstances';
import { BaseApiRepository } from './BaseApiRepository';

export interface GmailInstanceSettingsResult {
  instance: AdminInstance | null;
  settings: Record<string, unknown> | null;
  errors: string[];
}

export interface SlackInstanceSettingsResult {
  instance: AdminInstance | null;
  settings: Record<string, unknown> | null;
  errors: string[];
}

export interface GoogleDriveInstanceSettingsResult {
  instance: AdminInstance | null;
  settings: Record<string, unknown> | null;
  errors: string[];
}

export interface GoogleCalendarInstanceSettingsResult {
  instance: AdminInstance | null;
  settings: Record<string, unknown> | null;
  errors: string[];
}

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

  public async updateAdminInstanceRaw(
    id: number,
    data: Record<string, unknown>
  ): Promise<APIResponse> {
    if (!Number.isFinite(id)) {
      throw new Error('AdminInstancesRepository.updateAdminInstanceRaw: id must be a finite number');
    }
    return this.request.put(`${this.getCompleteUrl()}/${id}`, {
      headers: this.getResponseTypeHeaders(true),
      data
    });
  }

  public async getPreparedJson(): Promise<AdminInstance[]> {
    const response = await this.getAdminInstancesRaw();
    const parsed = await this.parsePreparedFromResponse(response);
    if (!parsed.instances) {
      throw new Error(parsed.errors.join(' ') || 'Failed to parse admin instances response');
    }
    return parsed.instances;
  }

  public async getFileSystemInstance(): Promise<{ instance: AdminInstance | null; errors: string[] }> {
    const errors: string[] = [];
    let instances: AdminInstance[];
    try {
      instances = await this.getPreparedJson();
    } catch (err) {
      errors.push(
        `Failed to fetch admin instances: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instance: null, errors };
    }

    const fileSystemInstances = instances.filter(
      (instance) => instance.connectorId === 'file-system'
    );

    if (fileSystemInstances.length === 0) {
      errors.push('No file-system instance found in /admin/instances.');
      return { instance: null, errors };
    }

    if (fileSystemInstances.length > 1) {
      console.info('Multiple file-system instances found; using the first.');
    }

    return { instance: fileSystemInstances[0], errors };
  }

  public async getGmailSettingsForUserEmail(
    userEmail: string
  ): Promise<GmailInstanceSettingsResult> {
    const errors: string[] = [];
    let instances: AdminInstance[];
    try {
      instances = await this.getPreparedJson();
    } catch (err) {
      errors.push(
        `Failed to fetch admin instances: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instance: null, settings: null, errors };
    }

    const gmailInstances = instances.filter(
      (instance) => instance.connectorId === 'gmail' && instance.enabled
    );

    if (gmailInstances.length === 0) {
      errors.push('No enabled Gmail instances found in /admin/instances.');
      return { instance: null, settings: null, errors };
    }

    const parsedSettings: Array<{ instance: AdminInstance; settings: Record<string, unknown> }> = [];

    for (const instance of gmailInstances) {
      try {
        const settings = JSON.parse(instance.settingsJson) as Record<string, unknown>;
        parsedSettings.push({ instance, settings });
      } catch (err) {
        errors.push(
          `Failed to parse settingsJson for Gmail instance id=${instance.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const matching = parsedSettings.filter((entry) => {
      const account = entry.settings.account as { userEmail?: unknown } | undefined;
      return typeof account?.userEmail === 'string' && account.userEmail === userEmail;
    });

    if (matching.length === 0) {
      errors.push(`No Gmail instance settings found for userEmail=${userEmail}.`);
      return { instance: null, settings: null, errors };
    }

    if (matching.length > 1) {
      console.info(`Multiple Gmail instances matched userEmail=${userEmail}; using the first.`);
    }

    const selected = matching[0];
    return { instance: selected.instance, settings: selected.settings, errors };
  }

  public async getSlackSettingsForWorkspace(
    workspaceId: string
  ): Promise<SlackInstanceSettingsResult> {
    const errors: string[] = [];
    let instances: AdminInstance[];
    try {
      instances = await this.getPreparedJson();
    } catch (err) {
      errors.push(
        `Failed to fetch admin instances: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instance: null, settings: null, errors };
    }

    const slackInstances = instances.filter(
      (instance) => instance.connectorId === 'slack' && instance.enabled
    );

    if (slackInstances.length === 0) {
      errors.push('No enabled Slack instances found in /admin/instances.');
      return { instance: null, settings: null, errors };
    }

    const parsedSettings: Array<{ instance: AdminInstance; settings: Record<string, unknown> }> = [];

    for (const instance of slackInstances) {
      try {
        const settings = JSON.parse(instance.settingsJson) as Record<string, unknown>;
        parsedSettings.push({ instance, settings });
      } catch (err) {
        errors.push(
          `Failed to parse settingsJson for Slack instance id=${instance.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const matching = parsedSettings.filter((entry) => {
      const workspace = entry.settings.workspace as { workspaceId?: unknown } | undefined;
      return typeof workspace?.workspaceId === 'string' && workspace.workspaceId === workspaceId;
    });

    if (matching.length === 0) {
      errors.push(`No Slack instance settings found for workspaceId=${workspaceId}.`);
      return { instance: null, settings: null, errors };
    }

    if (matching.length > 1) {
      console.info(`Multiple Slack instances matched workspaceId=${workspaceId}; using the first.`);
    }

    const selected = matching[0];
    return { instance: selected.instance, settings: selected.settings, errors };
  }

  public async getGoogleDriveSettingsForUserEmail(
    userEmail: string
  ): Promise<GoogleDriveInstanceSettingsResult> {
    const errors: string[] = [];
    let instances: AdminInstance[];
    try {
      instances = await this.getPreparedJson();
    } catch (err) {
      errors.push(
        `Failed to fetch admin instances: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instance: null, settings: null, errors };
    }

    const driveInstances = instances.filter(
      (instance) => instance.connectorId === 'google-drive' && instance.enabled
    );

    if (driveInstances.length === 0) {
      errors.push('No enabled Google Drive instances found in /admin/instances.');
      return { instance: null, settings: null, errors };
    }

    const parsedSettings: Array<{ instance: AdminInstance; settings: Record<string, unknown> }> = [];

    for (const instance of driveInstances) {
      try {
        const settings = JSON.parse(instance.settingsJson) as Record<string, unknown>;
        parsedSettings.push({ instance, settings });
      } catch (err) {
        errors.push(
          `Failed to parse settingsJson for Google Drive instance id=${instance.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const matching = parsedSettings.filter((entry) => {
      const settingsEmail = typeof entry.settings.email === 'string'
        ? entry.settings.email
        : (entry.settings.account as { email?: unknown } | undefined)?.email;
      return typeof settingsEmail === 'string' && settingsEmail === userEmail;
    });

    if (matching.length === 0) {
      errors.push(`No Google Drive instance settings found for email=${userEmail}.`);
      return { instance: null, settings: null, errors };
    }

    if (matching.length > 1) {
      console.info(`Multiple Google Drive instances matched email=${userEmail}; using the first.`);
    }

    const selected = matching[0];
    return { instance: selected.instance, settings: selected.settings, errors };
  }

  public async getGoogleCalendarSettingsForUserEmail(
    userEmail: string
  ): Promise<GoogleCalendarInstanceSettingsResult> {
    const errors: string[] = [];
    let instances: AdminInstance[];
    try {
      instances = await this.getPreparedJson();
    } catch (err) {
      errors.push(
        `Failed to fetch admin instances: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instance: null, settings: null, errors };
    }

    const calendarInstances = instances.filter(
      (instance) => instance.connectorId === 'google-calendar' && instance.enabled
    );

    if (calendarInstances.length === 0) {
      errors.push('No enabled Google Calendar instances found in /admin/instances.');
      return { instance: null, settings: null, errors };
    }

    const parsedSettings: Array<{ instance: AdminInstance; settings: Record<string, unknown> }> = [];

    for (const instance of calendarInstances) {
      try {
        const settings = JSON.parse(instance.settingsJson) as Record<string, unknown>;
        parsedSettings.push({ instance, settings });
      } catch (err) {
        errors.push(
          `Failed to parse settingsJson for Google Calendar instance id=${instance.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    const matching = parsedSettings.filter((entry) => {
      const settingsEmail = typeof entry.settings.email === 'string'
        ? entry.settings.email
        : (entry.settings.account as { email?: unknown } | undefined)?.email;
      return typeof settingsEmail === 'string' && settingsEmail === userEmail;
    });

    if (matching.length === 0) {
      errors.push(`No Google Calendar instance settings found for email=${userEmail}.`);
      return { instance: null, settings: null, errors };
    }

    if (matching.length > 1) {
      console.info(`Multiple Google Calendar instances matched email=${userEmail}; using the first.`);
    }

    const selected = matching[0];
    return { instance: selected.instance, settings: selected.settings, errors };
  }

  public async parsePreparedFromResponse(
    response: APIResponse
  ): Promise<{ instances: AdminInstance[] | null; errors: string[] }> {
    const errors: string[] = [];

    let instances: AdminInstance[];
    try {
      instances = (await this.parseJsonResponse<AdminInstance[]>(response)) as AdminInstance[];
    } catch (err) {
      errors.push(
        `Failed to parse admin instances response JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return { instances: null, errors };
    }

    if (!Array.isArray(instances)) {
      errors.push('Response should be an array of admin instances');
      return { instances: null, errors };
    }

    const prepared = instances.map((instance) => ({
      ...instance,
      id: Number(instance.id),
      enabled: Boolean(instance.enabled),
      totalItemsProcessed: Number(instance.totalItemsProcessed),
      entityResolutionCompleted: Number(instance.entityResolutionCompleted)
    }));

    return { instances: prepared, errors };
  }
}
