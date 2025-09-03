export interface ArtifactVersion {
  id: string;
  versionNumber: number;
  timestamp: Date;
  description: string;
  author: string;
  artifactType: "requirement" | "viewpoint" | "testcase";
  artifactId: string;
  snapshot: any; // Full artifact snapshot
  changesSummary: string[];
  isAutoSave?: boolean;
}

export interface VersionManager {
  versions: ArtifactVersion[];
  currentVersion: number;
  hasUnsavedChanges: boolean;
}

export interface VersionAction {
  type: "save" | "restore" | "view-history" | "create-checkpoint";
  artifactType?: "requirement" | "viewpoint" | "testcase";
  artifactId?: string;
  versionId?: string;
  description?: string;
}