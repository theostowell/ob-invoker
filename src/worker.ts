import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  AgentSkillsSettings,
  SkillDefinition,
  WorkerBackend,
  WorkerProgress,
  WorkerResult
} from "./types";

export interface WorkerRequest {
  vaultRoot: string;
  filePath: string;
  selection: string;
  skill: SkillDefinition;
  settings: AgentSkillsSettings;
}

export interface WorkerHandle {
  result: Promise<WorkerResult>;
  cancel: () => void;
}

interface ParsedWorkerEvent {
  progress?: WorkerProgress;
  finalMessage?: string;
  error?: string;
}

function firstExecutable(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next conventional installation path.
    }
  }
  return null;
}

export function resolveCodexBinary(configuredPath: string, home = os.homedir()): string {
  if (configuredPath.trim()) return configuredPath.trim();
  return firstExecutable([
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ]) ?? "codex";
}

export function resolveOpencodeBinary(configuredPath: string, home = os.homedir()): string {
  if (configuredPath.trim()) return configuredPath.trim();
  return firstExecutable([
    path.join(home, ".opencode", "bin", "opencode"),
    path.join(home, ".local", "bin", "opencode"),
    "/opt/homebrew/bin/opencode",
    "/usr/local/bin/opencode"
  ]) ?? "opencode";
}

export function workerBackend(settings: Pick<AgentSkillsSettings, "backend">): WorkerBackend {
  return settings.backend === "opencode" ? "opencode" : "codex";
}

export function workerLabel(backend: WorkerBackend): string {
  return backend === "opencode" ? "OpenCode" : "Codex";
}

export function resolveWorkerBinary(settings: AgentSkillsSettings, home = os.homedir()): string {
  return workerBackend(settings) === "opencode"
    ? resolveOpencodeBinary(settings.opencodePath, home)
    : resolveCodexBinary(settings.codexPath, home);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildWorkerPrompt(request: Pick<WorkerRequest, "filePath" | "selection" | "skill">): string {
  const selectionBlock = request.selection.trim()
    ? `\n<editor_selection path="${xmlEscape(request.filePath)}">\n${request.selection}\n</editor_selection>\n`
    : "";

  return `You are an autonomous Obsidian skill worker. The user explicitly chose one action and expects you to complete it now without conversational back-and-forth.

Read and follow this skill file exactly:
${request.skill.filePath}

Run the skill: ${request.skill.name}
Target vault file: ${request.filePath}
${selectionBlock}
Rules for this run:
- Treat the target file (and the editor selection when present) as the user's input to the skill.
- The target may be Markdown, HTML, or another vault file. Do not assume it is a note.
- Follow the vault's AGENTS.md and the selected SKILL.md, including every safety, validation, and output-location rule.
- Make reasonable assumptions instead of asking follow-up questions unless execution is genuinely impossible.
- Perform the work fully, including permitted file writes and validation. Do not merely explain what you would do.
- Do not publish, deploy, send, or push anything unless the selected skill explicitly requires it and its confirmation rules are satisfied.
- Finish with a concise summary of what changed, where it changed, and any genuine blocker.`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function parseCodexEvent(event: unknown): ParsedWorkerEvent {
  const record = asRecord(event);
  if (!record) return {};

  if (record.type === "thread.started") {
    return {
      progress: {
        message: "Worker connected…",
        threadId: typeof record.thread_id === "string" ? record.thread_id : undefined
      }
    };
  }
  if (record.type === "turn.started") return { progress: { message: "Reading the skill and file…" } };
  if (record.type === "turn.completed") return { progress: { message: "Finalising…" } };

  const item = asRecord(record.item);
  if (!item) return {};

  if (record.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
    return { finalMessage: item.text };
  }

  switch (item.type) {
    case "command_execution":
      return { progress: { message: record.type === "item.completed" ? "Command finished…" : "Running a command…" } };
    case "file_change":
      return { progress: { message: "Writing changes…" } };
    case "mcp_tool_call":
      return { progress: { message: "Using a connected tool…" } };
    case "web_search":
      return { progress: { message: "Checking sources…" } };
    case "agent_message":
      return { progress: { message: "Wrapping up…" } };
    default:
      return {};
  }
}

function opencodeToolMessage(tool: string): string {
  switch (tool) {
    case "bash":
      return "Running a command…";
    case "edit":
    case "write":
    case "patch":
      return "Writing changes…";
    case "webfetch":
    case "websearch":
      return "Checking sources…";
    case "task":
      return "Using a connected tool…";
    case "read":
    case "glob":
    case "grep":
    case "skill":
      return "Reading the skill and file…";
    default:
      return "Working…";
  }
}

function opencodeErrorText(error: unknown): string | undefined {
  if (typeof error === "string" && error.trim()) return error.trim();
  const record = asRecord(error);
  if (!record) return undefined;
  const data = asRecord(record.data);
  if (data && typeof data.message === "string" && data.message.trim()) return data.message.trim();
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  if (typeof record.name === "string" && record.name.trim()) return record.name.trim();
  return undefined;
}

export function parseOpencodeEvent(event: unknown): ParsedWorkerEvent {
  const record = asRecord(event);
  if (!record || typeof record.type !== "string") return {};

  const threadId = typeof record.sessionID === "string" ? record.sessionID : undefined;
  const withThread = (message: string): ParsedWorkerEvent => ({
    progress: threadId ? { message, threadId } : { message }
  });

  if (record.type === "error") {
    return { error: opencodeErrorText(record.error) ?? "OpenCode reported an error." };
  }

  if (record.type === "step_start") return withThread("Reading the skill and file…");
  if (record.type === "step_finish") return withThread("Finalising…");

  if (record.type === "text") {
    const part = asRecord(record.part);
    return typeof part?.text === "string" && part.text.trim()
      ? { finalMessage: part.text.trim() }
      : {};
  }

  if (record.type === "tool_use") {
    const part = asRecord(record.part);
    const tool = typeof part?.tool === "string" ? part.tool : "";
    return withThread(opencodeToolMessage(tool));
  }

  return threadId ? { progress: { message: "Worker connected…", threadId } } : {};
}

export function buildCodexArgs(request: WorkerRequest): string[] {
  const args = [
    "exec",
    "--cd",
    request.vaultRoot,
    "--skip-git-repo-check",
    "--json",
    "--color",
    "never"
  ];

  if (request.settings.model.trim()) args.push("--model", request.settings.model.trim());
  if (request.settings.access === "full") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("--sandbox", "workspace-write", "-c", 'approval_policy="never"');
  }
  args.push("-");
  return args;
}

export function buildOpencodeArgs(request: WorkerRequest): string[] {
  const args = [
    "run",
    "--dir",
    request.vaultRoot,
    "--format",
    "json",
    "--title",
    `${request.skill.name} · ${path.basename(request.filePath)}`,
    "--auto"
  ];
  if (request.settings.model.trim()) args.push("--model", request.settings.model.trim());
  return args;
}

export function opencodePermissionConfig(access: AgentSkillsSettings["access"]): string {
  return JSON.stringify({
    external_directory: access === "full" ? "allow" : "deny"
  });
}

function workerPath(home = os.homedir()): string {
  return [
    process.env.PATH ?? "",
    path.join(home, ".opencode", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ].filter(Boolean).join(path.delimiter);
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid || child.killed) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function spawnWorker(
  request: WorkerRequest,
  spec: {
    binary: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    label: string;
    parseEvent: (event: unknown) => ParsedWorkerEvent;
  },
  onProgress: (progress: WorkerProgress) => void
): WorkerHandle {
  const child = spawn(spec.binary, spec.args, {
    cwd: request.vaultRoot,
    detached: process.platform !== "win32",
    env: spec.env,
    stdio: ["pipe", "pipe", "pipe"]
  });

  let cancelled = false;
  let settled = false;
  let stdoutBuffer = "";
  let stderr = "";
  let finalMessage = "";
  let reportedError = "";
  let threadId: string | undefined;

  const processLine = (line: string): void => {
    if (!line.trim()) return;
    try {
      const parsed = spec.parseEvent(JSON.parse(line));
      if (parsed.progress) {
        if (parsed.progress.threadId) threadId = parsed.progress.threadId;
        onProgress(parsed.progress);
      }
      if (parsed.finalMessage) finalMessage = parsed.finalMessage;
      if (parsed.error) reportedError = parsed.error;
    } catch {
      // Workers can emit non-JSON diagnostics alongside JSONL.
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-12000);
  });

  child.stdin.end(buildWorkerPrompt(request));

  const result = new Promise<WorkerResult>((resolve, reject) => {
    child.once("error", (error) => {
      settled = true;
      reject(new Error(`Could not start ${spec.label} at “${spec.binary}”: ${error.message}`));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      processLine(stdoutBuffer);
      if (cancelled) {
        resolve({ cancelled: true, finalMessage: "", threadId });
        return;
      }
      if (code === 0) {
        resolve({
          cancelled: false,
          finalMessage: finalMessage || "The worker completed successfully.",
          threadId
        });
        return;
      }
      const diagnostic = reportedError || stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new Error(diagnostic || `${spec.label} exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`));
    });
  });

  return {
    result,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      killProcessTree(child);
      window.setTimeout(() => {
        if (!settled) {
          try {
            if (process.platform === "win32") child.kill("SIGKILL");
            else if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, 2000);
    }
  };
}

export function startCodexWorker(
  request: WorkerRequest,
  onProgress: (progress: WorkerProgress) => void
): WorkerHandle {
  return spawnWorker(request, {
    binary: resolveCodexBinary(request.settings.codexPath),
    args: buildCodexArgs(request),
    env: { ...process.env, PATH: workerPath() },
    label: "Codex",
    parseEvent: parseCodexEvent
  }, onProgress);
}

export function startOpencodeWorker(
  request: WorkerRequest,
  onProgress: (progress: WorkerProgress) => void
): WorkerHandle {
  return spawnWorker(request, {
    binary: resolveOpencodeBinary(request.settings.opencodePath),
    args: buildOpencodeArgs(request),
    env: {
      ...process.env,
      PATH: workerPath(),
      OPENCODE_PERMISSION: opencodePermissionConfig(request.settings.access)
    },
    label: "OpenCode",
    parseEvent: parseOpencodeEvent
  }, onProgress);
}

export function startWorker(
  request: WorkerRequest,
  onProgress: (progress: WorkerProgress) => void
): WorkerHandle {
  return workerBackend(request.settings) === "opencode"
    ? startOpencodeWorker(request, onProgress)
    : startCodexWorker(request, onProgress);
}
