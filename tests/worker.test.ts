import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildOpencodeArgs,
  buildWorkerPrompt,
  opencodePermissionConfig,
  parseCodexEvent,
  parseOpencodeEvent,
  resolveCodexBinary,
  resolveOpencodeBinary,
  resolveWorkerBinary,
  workerBackend
} from "../src/worker";
import { DEFAULT_SETTINGS, coerceBackend } from "../src/types";

const skill = {
  name: "progress",
  description: "Advance the carousel.",
  filePath: "/vault/.agents/skills/progress/SKILL.md",
  source: "Vault"
};

test("buildWorkerPrompt pins one skill, the file, and editor selection", () => {
  const prompt = buildWorkerPrompt({
    filePath: '3-Resources/Content/A "draft".md',
    selection: "Selected paragraph",
    skill: {
      name: "compile-article",
      description: "Compile it.",
      filePath: "/vault/.agents/skills/compile-article/SKILL.md",
      source: "Vault"
    }
  });

  assert.match(prompt, /Read and follow this skill file exactly/);
  assert.match(prompt, /Run the skill: compile-article/);
  assert.match(prompt, /Target vault file: 3-Resources\/Content\/A "draft"\.md/);
  assert.match(prompt, /<editor_selection path="3-Resources\/Content\/A &quot;draft&quot;\.md">/);
  assert.match(prompt, /Selected paragraph/);
  assert.match(prompt, /Do not merely explain/);
});

test("buildWorkerPrompt omits the selection block when nothing is selected", () => {
  const prompt = buildWorkerPrompt({
    filePath: "Note.md",
    selection: "",
    skill: {
      name: "tidy",
      description: "Tidy it.",
      filePath: "/vault/.agents/skills/tidy/SKILL.md",
      source: "Vault"
    }
  });

  assert.doesNotMatch(prompt, /editor_selection/);
});

test("buildWorkerPrompt accepts a non-markdown target file", () => {
  const prompt = buildWorkerPrompt({
    filePath: "Content/Carousels/macondo-three-times-at-once.html",
    selection: "",
    skill
  });

  assert.match(prompt, /Target vault file: Content\/Carousels\/macondo-three-times-at-once\.html/);
  assert.match(prompt, /The target may be Markdown, HTML, or another vault file/);
  assert.doesNotMatch(prompt, /Target vault note/);
});

test("coerceBackend treats unknown values as Codex", () => {
  assert.equal(coerceBackend("opencode"), "opencode");
  assert.equal(coerceBackend("codex"), "codex");
  assert.equal(coerceBackend(undefined), "codex");
  assert.equal(workerBackend({ backend: "opencode" }), "opencode");
  assert.equal(workerBackend({ backend: "codex" }), "codex");
});

test("resolve binaries prefer a configured path and otherwise search home", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-skills-bin-"));
  const localBin = path.join(home, ".local", "bin");
  const opencodeBin = path.join(home, ".opencode", "bin");
  fs.mkdirSync(localBin, { recursive: true });
  fs.mkdirSync(opencodeBin, { recursive: true });
  const codex = path.join(localBin, "codex");
  const opencode = path.join(opencodeBin, "opencode");
  fs.writeFileSync(codex, "");
  fs.writeFileSync(opencode, "");
  fs.chmodSync(codex, 0o755);
  fs.chmodSync(opencode, 0o755);

  assert.equal(resolveCodexBinary("/custom/codex", home), "/custom/codex");
  assert.equal(resolveOpencodeBinary("/custom/opencode", home), "/custom/opencode");
  assert.equal(resolveCodexBinary("", home), codex);
  assert.equal(resolveOpencodeBinary("", home), opencode);
  assert.equal(resolveWorkerBinary({ ...DEFAULT_SETTINGS, backend: "opencode" }, home), opencode);
});

test("buildOpencodeArgs runs non-interactively against the vault", () => {
  const args = buildOpencodeArgs({
    vaultRoot: "/vault",
    filePath: "Content/Carousels/macondo.html",
    selection: "",
    skill,
    settings: { ...DEFAULT_SETTINGS, backend: "opencode", model: "anthropic/claude-sonnet-4-5" }
  });

  assert.deepEqual(args.slice(0, 6), ["run", "--dir", "/vault", "--format", "json", "--title"]);
  assert.equal(args[6], "progress · macondo.html");
  assert.ok(args.includes("--auto"));
  assert.deepEqual(args.slice(-2), ["--model", "anthropic/claude-sonnet-4-5"]);
});

test("opencodePermissionConfig gates external writes in workspace mode", () => {
  assert.equal(opencodePermissionConfig("full"), '{"external_directory":"allow"}');
  assert.equal(opencodePermissionConfig("workspace"), '{"external_directory":"deny"}');
});

test("parseCodexEvent still surfaces thread, writes, and the final message", () => {
  assert.deepEqual(parseCodexEvent({ type: "thread.started", thread_id: "abc" }), {
    progress: { message: "Worker connected…", threadId: "abc" }
  });
  assert.deepEqual(parseCodexEvent({ type: "item.started", item: { type: "file_change" } }), {
    progress: { message: "Writing changes…" }
  });
  assert.deepEqual(parseCodexEvent({
    type: "item.completed",
    item: { type: "agent_message", text: "Done." }
  }), {
    finalMessage: "Done."
  });
});

test("parseOpencodeEvent maps JSON run events onto overlay phases", () => {
  assert.deepEqual(parseOpencodeEvent({
    type: "step_start",
    sessionID: "ses_1"
  }), {
    progress: { message: "Reading the skill and file…", threadId: "ses_1" }
  });
  assert.deepEqual(parseOpencodeEvent({
    type: "tool_use",
    sessionID: "ses_1",
    part: { tool: "edit" }
  }), {
    progress: { message: "Writing changes…", threadId: "ses_1" }
  });
  assert.deepEqual(parseOpencodeEvent({
    type: "text",
    part: { text: "  Advanced the carousel.  " }
  }), {
    finalMessage: "Advanced the carousel."
  });
  assert.deepEqual(parseOpencodeEvent({
    type: "error",
    error: { data: { message: "usage exceeded" } }
  }), {
    error: "usage exceeded"
  });
});
