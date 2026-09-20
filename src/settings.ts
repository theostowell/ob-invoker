import { Notice, PluginSettingTab, Setting } from "obsidian";
import type AgentSkillsPlugin from "../main";
import { resolveWorkerBinary, workerBackend, workerLabel } from "./worker";

export class AgentSkillsSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: AgentSkillsPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const backend = workerBackend(this.plugin.settings);
    const label = workerLabel(backend);
    containerEl.empty();
    containerEl.createEl("h2", { text: "Agent Skills" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Turn the skill files already used by your agents into direct actions on the active file."
    });

    new Setting(containerEl)
      .setName("Worker backend")
      .setDesc("Codex or OpenCode. Switch here if one account is out of usage.")
      .addDropdown((dropdown) => dropdown
        .addOption("codex", "Codex")
        .addOption("opencode", "OpenCode")
        .setValue(backend)
        .onChange(async (value) => {
          this.plugin.settings.backend = value === "opencode" ? "opencode" : "codex";
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName(`${label} executable`)
      .setDesc(backend === "opencode"
        ? "Leave blank to auto-detect ~/.opencode/bin/opencode, ~/.local/bin/opencode, Homebrew, or your PATH."
        : "Leave blank to auto-detect ~/.local/bin/codex, Homebrew, or your PATH.")
      .addText((text) => text
        .setPlaceholder("Auto-detect")
        .setValue(backend === "opencode" ? this.plugin.settings.opencodePath : this.plugin.settings.codexPath)
        .onChange(async (value) => {
          if (backend === "opencode") this.plugin.settings.opencodePath = value.trim();
          else this.plugin.settings.codexPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(`Test ${label}`)
      .setDesc(`Currently resolves to: ${resolveWorkerBinary(this.plugin.settings)}`)
      .addButton((button) => button
        .setButtonText("Check installation")
        .onClick(async () => {
          button.setDisabled(true);
          const message = await this.plugin.checkWorkerInstallation();
          new Notice(message, 6000);
          button.setDisabled(false);
        }));

    new Setting(containerEl)
      .setName("Model override")
      .setDesc(backend === "opencode"
        ? "Optional. Use provider/model, e.g. anthropic/claude-sonnet-4-5. Leave blank for your OpenCode default."
        : "Optional. Leave blank to use your normal Codex default model.")
      .addText((text) => text
        .setPlaceholder(backend === "opencode" ? "provider/model" : "Use Codex default")
        .setValue(this.plugin.settings.model)
        .onChange(async (value) => {
          this.plugin.settings.model = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Worker file access")
      .setDesc("Full access is required by cross-repository skills such as compile-article. Vault/workspace only is safer for vault-only actions.")
      .addDropdown((dropdown) => dropdown
        .addOption("full", "Full file-system access")
        .addOption("workspace", "Vault/workspace only")
        .setValue(this.plugin.settings.access)
        .onChange(async (value) => {
          this.plugin.settings.access = value === "workspace" ? "workspace" : "full";
          await this.plugin.saveSettings();
        }));

    const warning = containerEl.createDiv({ cls: "agent-skills-settings-warning" });
    const strong = warning.createEl("strong", { text: "Full access is genuinely autonomous. " });
    strong.insertAdjacentText("afterend", "The chosen skill can change any file your local user can access. It still inherits AGENTS.md and the skill's own confirmation rules.");

    new Setting(containerEl)
      .setName("Include global skills")
      .setDesc("Also list skills from ~/.agents/skills.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeGlobalSkills)
        .onChange(async (value) => {
          this.plugin.settings.includeGlobalSkills = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Include legacy slash commands")
      .setDesc("Also list Markdown commands from .claude/commands in this vault.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.includeLegacyCommands)
        .onChange(async (value) => {
          this.plugin.settings.includeLegacyCommands = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Additional skill roots")
      .setDesc("One path per line. Relative paths resolve from the vault; ~ and absolute paths are supported.")
      .addTextArea((area) => {
        area
          .setPlaceholder("8-Agents/custom-skills\n~/some-other-skills")
          .setValue(this.plugin.settings.customSkillRoots)
          .onChange(async (value) => {
            this.plugin.settings.customSkillRoots = value;
            await this.plugin.saveSettings();
          });
        area.inputEl.rows = 4;
        area.inputEl.cols = 42;
      });
  }
}
