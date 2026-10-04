export interface InstructionVersion { version: string; compatible: boolean; prerelease: boolean; notes: string }
export interface InstructionComponent { id: string; title: string; kind: string; scope: "home" | "workspace"; default: boolean }
export interface InstructionDocument { path: string; title: string; kind: string }
export interface InstructionConflict { target: string; reason: string; current?: string; proposed?: string }
export interface InstructionUiState {
  repository: string;
  currentVersion: string | null;
  pinnedVersion: string | null;
  selectedVersion: string | null;
  versions: InstructionVersion[];
  downloadedVersions: string[];
  components: InstructionComponent[];
  selectedComponentIds?: string[];
  documents: InstructionDocument[];
  preview?: { path: string; text: string };
  conflicts: InstructionConflict[];
  error?: string;
  message?: string;
  busy?: string;
}
export type InstructionAction = "refresh" | "selectVersion" | "preview" | "download" | "apply" | "pin" | "unpin" | "rollback";
export interface InstructionRequest { version?: string; path?: string; componentIds?: string[] }
export interface InstructionUiPort {
  snapshot(): Promise<InstructionUiState>;
  request(action: InstructionAction, payload: InstructionRequest): Promise<InstructionUiState>;
}
