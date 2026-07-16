export type UpdatePolicy = "automatic" | "manual" | "disabled";
export type UpdateNetworkMode = "automaticProxy" | "manualProxy" | "direct";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdateSettings {
  updatePolicy: UpdatePolicy;
  updateNetworkMode: UpdateNetworkMode;
  manualProxyUrl: string;
}

export interface PendingUpdate {
  version: string;
  assetName: string;
  archivePath: string;
  size: number;
  sha256: string;
  downloadedAt: string;
}

export interface UpdateState {
  currentVersion: string;
  status: UpdateStatus;
  message: string;
  progress: number;
  availableVersion?: string;
  releaseUrl?: string;
  releaseNotes?: string;
  pending?: PendingUpdate | null;
  isDeferred?: boolean;
}

export interface UpdateBridge {
  getSettings(): Promise<UpdateSettings>;
  saveSettings(settings: UpdateSettings): Promise<UpdateSettings>;
  getState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  deferUpdate(): Promise<UpdateState>;
  installUpdateNow(): Promise<{ launched: boolean }>;
  onStateChanged(listener: (state: UpdateState) => void): () => void;
}
