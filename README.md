# Agent Skills

An Obsidian desktop plugin that turns local Codex-style skills into file actions. The worker can be Codex or OpenCode.

## What it does

- Discovers skills from `.agents/skills/*/SKILL.md` in the vault.
- Optionally includes `~/.agents/skills/*/SKILL.md` and custom skill roots.
- Opens a searchable **Run agent skill…** modal from the ribbon, command palette, editor context menu, or file menu.
- Sends the chosen skill, active file (Markdown, HTML, or any other file-backed view), and current selection to a non-interactive Codex or OpenCode worker. Switch backends in settings if one account is out of usage.
- Blurs and locks the file while the worker runs, prevents its tab from being closed or navigated away from, and provides live phase updates and cancellation.
- Lets the skill edit the vault or other permitted local files directly.

## Development/install

```bash
npm install
npm run check
ln -s /absolute/path/to/obsidian-agent-skills /path/to/vault/.obsidian/plugins/agent-skills
```

Enable **Agent Skills** under Obsidian → Community plugins.

## Safety

The default worker access mode is **Full file-system access**, because workflows such as `compile-article` write both to the vault and to an external Hugo repository. Every run is an autonomous Codex or OpenCode session and inherits the vault's `AGENTS.md` and the selected skill's own safety rules. Switch to **Vault/workspace only** in settings for skills that do not need external writes.
