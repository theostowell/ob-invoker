import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverSkills, expandSkillRoot, parseSkillMetadata } from "../src/skills";
import { DEFAULT_SETTINGS } from "../src/types";

test("parseSkillMetadata reads the standard skill frontmatter", () => {
  const metadata = parseSkillMetadata(`---
name: compile-article
description: Turn an outline into an article.
---
# Instructions`, "fallback");

  assert.deepEqual(metadata, {
    name: "compile-article",
    description: "Turn an outline into an article."
  });
});

test("expandSkillRoot supports vault-relative and home-relative paths", () => {
  assert.equal(expandSkillRoot(".agents/skills", "/vault", "/home/theo"), "/vault/.agents/skills");
  assert.equal(expandSkillRoot("~/skills", "/vault", "/home/theo"), "/home/theo/skills");
});

test("discoverSkills gives vault skills precedence over duplicate custom skills", async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), "agent-skills-vault-"));
  const custom = await fs.mkdtemp(path.join(os.tmpdir(), "agent-skills-custom-"));
  try {
    await fs.mkdir(path.join(vault, ".agents", "skills", "compile-article"), { recursive: true });
    await fs.writeFile(
      path.join(vault, ".agents", "skills", "compile-article", "SKILL.md"),
      "---\nname: compile-article\ndescription: Vault version.\n---\n"
    );
    await fs.mkdir(path.join(custom, "compile-article"), { recursive: true });
    await fs.writeFile(
      path.join(custom, "compile-article", "SKILL.md"),
      "---\nname: compile-article\ndescription: Custom version.\n---\n"
    );

    const skills = await discoverSkills(vault, {
      ...DEFAULT_SETTINGS,
      includeGlobalSkills: false,
      includeLegacyCommands: false,
      customSkillRoots: custom
    });

    assert.equal(skills.length, 1);
    assert.equal(skills[0].description, "Vault version.");
    assert.equal(skills[0].source, "Vault");
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
    await fs.rm(custom, { recursive: true, force: true });
  }
});
