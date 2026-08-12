import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkerPrompt } from "../src/worker";

test("buildWorkerPrompt pins one skill, the note, and editor selection", () => {
  const prompt = buildWorkerPrompt({
    notePath: '3-Resources/Content/A "draft".md',
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
  assert.match(prompt, /Target vault note: 3-Resources\/Content\/A "draft"\.md/);
  assert.match(prompt, /<editor_selection path="3-Resources\/Content\/A &quot;draft&quot;\.md">/);
  assert.match(prompt, /Selected paragraph/);
  assert.match(prompt, /Do not merely explain/);
});

test("buildWorkerPrompt omits the selection block when nothing is selected", () => {
  const prompt = buildWorkerPrompt({
    notePath: "Note.md",
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
