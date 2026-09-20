export type WorkerAccess = "full" | "workspace";
export type WorkerBackend = "codex" | "opencode";

export function coerceBackend(value: unknown): WorkerBackend {
  return value === "opencode" ? "opencode" : "codex";
}

export interface AgentSkillsSettings {
  backend: WorkerBackend;
  codexPath: string;
  opencodePath: string;
  model: string;
  access: WorkerAccess;
  includeGlobalSkills: boolean;
  includeLegacyCommands: boolean;
  customSkillRoots: string;
}

export const DEFAULT_SETTINGS: AgentSkillsSettings = {
  backend: "codex",
  codexPath: "",
  opencodePath: "",
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
