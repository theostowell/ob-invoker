import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSkillsSettings, SkillDefinition } from "./types";

interface ScanRoot {
  root: string;
  source: string;
  legacyFiles?: boolean;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkillMetadata(content: string, fallbackName: string): Pick<SkillDefinition, "name" | "description"> {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1] ?? "";
  const fields = new Map<string, string>();

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_/-]+):\s*(.*?)\s*$/);
    if (match) fields.set(match[1], unquote(match[2]));
  }

  return {
    name: fields.get("name") || fallbackName,
    description: fields.get("description") || "Run this skill against the active note."
  };
}

export function expandSkillRoot(input: string, vaultRoot: string, home = os.homedir()): string {
  const trimmed = input.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(vaultRoot, trimmed);
}

async function scanNativeRoot(scanRoot: ScanRoot): Promise<SkillDefinition[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(scanRoot.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const filePath = path.join(scanRoot.root, entry.name, "SKILL.md");
    try {
      const content = await fs.readFile(filePath, "utf8");
      const metadata = parseSkillMetadata(content, entry.name);
      skills.push({ ...metadata, filePath, source: scanRoot.source });
    } catch {
      // A folder without a readable SKILL.md is not a runnable skill.
    }
  }
  return skills;
}

async function scanLegacyRoot(scanRoot: ScanRoot): Promise<SkillDefinition[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(scanRoot.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) continue;
    const filePath = path.join(scanRoot.root, entry.name);
    const fallbackName = entry.name.slice(0, -3);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const metadata = parseSkillMetadata(content, fallbackName);
      skills.push({ ...metadata, filePath, source: scanRoot.source });
    } catch {
      // Ignore unreadable command files.
    }
  }
  return skills;
}

export async function discoverSkills(vaultRoot: string, settings: AgentSkillsSettings): Promise<SkillDefinition[]> {
  const roots: ScanRoot[] = [
    { root: path.join(vaultRoot, ".agents", "skills"), source: "Vault" }
  ];

  for (const customRoot of settings.customSkillRoots.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    roots.push({ root: expandSkillRoot(customRoot, vaultRoot), source: "Custom" });
  }

  if (settings.includeLegacyCommands) {
    roots.push({
      root: path.join(vaultRoot, ".claude", "commands"),
      source: "Legacy",
      legacyFiles: true
    });
  }

  if (settings.includeGlobalSkills) {
    roots.push({ root: path.join(os.homedir(), ".agents", "skills"), source: "Global" });
  }

  const discovered = (await Promise.all(
    roots.map((root) => root.legacyFiles ? scanLegacyRoot(root) : scanNativeRoot(root))
  )).flat();

  const unique = new Map<string, SkillDefinition>();
  for (const skill of discovered) {
    const key = skill.name.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, skill);
  }

  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
