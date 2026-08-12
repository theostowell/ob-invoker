export type WorkerAccess = "full" | "workspace";

export interface AgentSkillsSettings {
  codexPath: string;
  model: string;
  access: WorkerAccess;
  includeGlobalSkills: boolean;
  includeLegacyCommands: boolean;
  customSkillRoots: string;
}

export const DEFAULT_SETTINGS: AgentSkillsSettings = {
  codexPath: "",
  model: "",
  access: "full",
  includeGlobalSkills: true,
  includeLegacyCommands: true,
  customSkillRoots: ""
};

export interface SkillDefinition {
  name: string;
  description: string;
  filePath: string;
  source: string;
}

export interface WorkerProgress {
  message: string;
  threadId?: string;
}

export interface WorkerResult {
  cancelled: boolean;
  finalMessage: string;
  threadId?: string;
}
