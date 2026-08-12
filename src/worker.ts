import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSkillsSettings, SkillDefinition, WorkerProgress, WorkerResult } from "./types";

export interface WorkerRequest {
  vaultRoot: string;
  notePath: string;
  selection: string;
  skill: SkillDefinition;
  settings: AgentSkillsSettings;
}

export interface WorkerHandle {
  result: Promise<WorkerResult>;
  cancel: () => void;
}

export function resolveCodexBinary(configuredPath: string, home = os.homedir()): string {
  if (configuredPath.trim()) return configuredPath.trim();

  const candidates = [
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next conventional installation path.
    }
  }
  return "codex";
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function buildWorkerPrompt(request: Pick<WorkerRequest, "notePath" | "selection" | "skill">): string {
  const selectionBlock = request.selection.trim()
    ? `\n<editor_selection path="${xmlEscape(request.notePath)}">\n${request.selection}\n</editor_selection>\n`
    : "";

  return `You are an autonomous Obsidian skill worker. The user explicitly chose one action and expects you to complete it now without conversational back-and-forth.

Read and follow this skill file exactly:
${request.skill.filePath}

Run the skill: ${request.skill.name}
Target vault note: ${request.notePath}
${selectionBlock}
Rules for this run:
- Treat the target note (and the editor selection when present) as the user's input to the skill.
- Follow the vault's AGENTS.md and the selected SKILL.md, including every safety, validation, and output-location rule.
- Make reasonable assumptions instead of asking follow-up questions unless execution is genuinely impossible.
- Perform the work fully, including permitted file writes and validation. Do not merely explain what you would do.
- Do not publish, deploy, send, or push anything unless the selected skill explicitly requires it and its confirmation rules are satisfied.
- Finish with a concise summary of what changed, where it changed, and any genuine blocker.`;
}

function eventMessage(event: unknown): WorkerProgress | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (record.type === "thread.started") {
    return {
      message: "Worker connected…",
      threadId: typeof record.thread_id === "string" ? record.thread_id : undefined
    };
  }
  if (record.type === "turn.started") return { message: "Reading the skill and note…" };
  if (record.type === "turn.completed") return { message: "Finalising…" };

  const item = record.item;
  if (!item || typeof item !== "object") return null;
  const itemRecord = item as Record<string, unknown>;
  switch (itemRecord.type) {
    case "command_execution":
      return { message: record.type === "item.completed" ? "Command finished…" : "Running a command…" };
    case "file_change":
      return { message: "Writing changes…" };
    case "mcp_tool_call":
      return { message: "Using a connected tool…" };
    case "web_search":
      return { message: "Checking sources…" };
    case "agent_message":
      return { message: "Wrapping up…" };
    default:
      return null;
  }
}

function finalAgentMessage(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const record = event as Record<string, unknown>;
  if (record.type !== "item.completed" || !record.item || typeof record.item !== "object") return null;
  const item = record.item as Record<string, unknown>;
  return item.type === "agent_message" && typeof item.text === "string" ? item.text : null;
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

export function startCodexWorker(
  request: WorkerRequest,
  onProgress: (progress: WorkerProgress) => void
): WorkerHandle {
  const binary = resolveCodexBinary(request.settings.codexPath);
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

  const augmentedPath = [
    process.env.PATH ?? "",
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin"
  ].filter(Boolean).join(path.delimiter);

  const child = spawn(binary, args, {
    cwd: request.vaultRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, PATH: augmentedPath },
    stdio: ["pipe", "pipe", "pipe"]
  });

  let cancelled = false;
  let settled = false;
  let stdoutBuffer = "";
  let stderr = "";
  let finalMessage = "";
  let threadId: string | undefined;

  const processLine = (line: string): void => {
    if (!line.trim()) return;
    try {
      const event: unknown = JSON.parse(line);
      const progress = eventMessage(event);
      if (progress) {
        if (progress.threadId) threadId = progress.threadId;
        onProgress(progress);
      }
      const message = finalAgentMessage(event);
      if (message) finalMessage = message;
    } catch {
      // Codex can occasionally emit non-JSON diagnostics alongside JSONL.
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
      reject(new Error(`Could not start Codex at “${binary}”: ${error.message}`));
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
      const diagnostic = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      reject(new Error(diagnostic || `Codex exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`));
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
