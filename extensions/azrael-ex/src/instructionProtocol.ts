export type InstructionUiText = string | { en: string; ko: string };
export interface InstructionVersion { version: string; compatible: boolean; prerelease: boolean; notes: InstructionUiText }
export interface InstructionComponent { id: string; title: string; kind: string; scope: "home" | "workspace"; default: boolean }
export interface InstructionDocument { path: string; title: string; kind: string }
export interface InstructionConflict { target: string; reason: string; current?: string; proposed?: string }
export type InstructionResourceKind = "skill" | "agent-role" | "context" | "task-profile" | "playbook";
export type InstructionSharing = "public" | "collaborators" | "local";
export interface InstructionResourceFile { path: string; encoding: "utf8" | "base64"; content: string }
export interface InstructionResource {
  id: string; name: string; kind: InstructionResourceKind; sharing: InstructionSharing; digest: string;
  validationErrors: string[]; installedDigest?: string | null;
  publications: Array<{ repository: string; version: string; digest: string; commit?: string }>;
  files?: InstructionResourceFile[];
  version?: number;
  documentVersion?: string;
  catalogId?: string;
  description?: string;
  sourceKind?: "library" | "builtin" | "installed" | "remote";
  sourceLabel?: string;
  readOnly?: boolean;
  versionLabel?: string;
  versions?: Array<{ digest: string; label: string }>;
  ownership?: "personal" | "downloaded";
  provenance?: { sourceKind: string; repository?: string; resourceId: string; digest: string; versionLabel?: string };
  skillEnabled?: boolean;
  canToggleSkill?: boolean;
  canMigrate?: boolean;
  projectStatus?: { state: "missing" | "downloaded" | "different" | "unknown" | "conflict"; version?: string; path: string };
  profile?: { model: string; provider?: string; reasoningEffort?: string; dependencies: Array<{ id: string; digest: string; optional?: boolean }>; instructions?: string; harness?: unknown };
}
export interface InstructionLibraryUiState {
  revision: number; entries: InstructionResource[]; selected?: InstructionResource;
  connections: Array<{ sharing: "public" | "collaborators"; repository: string; branch: string; readable?: boolean; writable?: boolean }>;
  remoteVersions?: Array<{ version: string; notes?: string; sharing?: "public" | "collaborators"; repository?: string }>;
  projects?: Array<{ id: string; name: string }>;
  selectedProject?: string;
  sourceMode?: "release" | "project";
  sourceProject?: string;
  notices?: InstructionUiText[];
  comparison?: { id: string; from: string; to: string; files: Array<{ path: string; current?: string; proposed?: string }>; error?: InstructionUiText };
  plan?: { token: string; kind: "apply" | "publish" | "task" | "delete" | "migrate"; acquire?: boolean; summary: InstructionUiText; conflicts: InstructionConflict[]; diffs?: Array<{ path?: string; target?: string; current?: string; proposed?: string }>; model?: string; provider?: string };
  operation?: { id?: string; phase: string; repository?: string; version?: string };
}
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
  error?: InstructionUiText;
  message?: InstructionUiText | readonly InstructionUiText[];
  busy?: string;
  library?: InstructionLibraryUiState;
}
export type InstructionAction = "refresh" | "selectVersion" | "preview" | "download" | "apply" | "pin" | "unpin" | "rollback"
  | "libraryRefresh" | "libraryImport" | "libraryCreate" | "librarySelect" | "librarySave"
  | "libraryPlanApply" | "libraryApply" | "libraryPlanPublish" | "libraryPublish" | "libraryRecover"
  | "libraryConnect" | "libraryRemoteRefresh" | "libraryRemoteImport" | "libraryPrepareTask" | "libraryStartTask"
  | "libraryCompare" | "libraryInspectVersion" | "librarySetProject" | "libraryPlanAcquire" | "libraryAcquire" | "libraryBack" | "libraryOpenInstalled"
  | "librarySetSource" | "librarySetSkillEnabled" | "libraryPlanDelete" | "libraryDelete" | "libraryPlanMigrate" | "libraryMigrate";
export interface InstructionRequest {
  version?: string; path?: string; componentIds?: string[]; id?: string; ids?: string[];
  name?: string; kind?: InstructionResourceKind; sharing?: InstructionSharing; files?: InstructionResourceFile[];
  profile?: InstructionResource["profile"]; revision?: number; token?: string;
  repository?: string; branch?: string; model?: string; provider?: string; reasoningEffort?: string;
  digest?: string; fromDigest?: string; toDigest?: string; project?: string;
  enabled?: boolean; removeInstallation?: boolean; sourceMode?: "release" | "project"; sourceProject?: string;
  installationName?: string;
}
export interface InstructionUiPort {
  snapshot(): Promise<InstructionUiState>;
  request(action: InstructionAction, payload: InstructionRequest): Promise<InstructionUiState>;
}
