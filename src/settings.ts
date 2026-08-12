import { Notice, PluginSettingTab, Setting } from "obsidian";
import type AgentSkillsPlugin from "../main";
import { resolveCodexBinary } from "./worker";

export class AgentSkillsSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: AgentSkillsPlugin) {
    super(plugin.app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Agent Skills" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Turn the skill files already used by your agents into direct actions on the active note."
    });

    new Setting(containerEl)
      .setName("Codex executable")
      .setDesc("Leave blank to auto-detect ~/.local/bin/codex, Homebrew, or your PATH.")
      .addText((text) => text
        .setPlaceholder("Auto-detect")
        .setValue(this.plugin.settings.codexPath)
        .onChange(async (value) => {
          this.plugin.settings.codexPath = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Test Codex")
      .setDesc(`Currently resolves to: ${resolveCodexBinary(this.plugin.settings.codexPath)}`)
      .addButton((button) => button
        .setButtonText("Check installation")
        .onClick(async () => {
          button.setDisabled(true);
          const message = await this.plugin.checkCodexInstallation();
          new Notice(message, 6000);
          button.setDisabled(false);
        }));

    new Setting(containerEl)
      .setName("Model override")
      .setDesc("Optional. Leave blank to use your normal Codex default model.")
      .addText((text) => text
        .setPlaceholder("Use Codex default")
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
