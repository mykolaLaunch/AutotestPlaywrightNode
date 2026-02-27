export interface AdminInstance {
  id: number;
  tenantId: string;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  settingsJson: string;
  status: string;
  error: string | null;
  createdUtc: string;
  updatedUtc: string;
  totalItemsProcessed: number;
  lastSyncUtc: string | null;
  syncPhase: string | null;
  entityResolutionCompleted: number;
}
