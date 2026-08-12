import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Editor,
  FileSystemAdapter,
  MarkdownView,
  type MarkdownFileInfo,
  Menu,
  Notice,
  Plugin
} from "obsidian";
import { WorkingOverlay } from "./src/overlay";
import { lockLeafToNote, type LeafLock } from "./src/leaf-lock";
import { SkillPickerModal } from "./src/picker";
import { AgentSkillsSettingTab } from "./src/settings";
import { discoverSkills } from "./src/skills";
import {
  DEFAULT_SETTINGS,
  type AgentSkillsSettings,
  type SkillDefinition
} from "./src/types";
import { resolveCodexBinary, startCodexWorker, type WorkerHandle } from "./src/worker";

const execFileAsync = promisify(execFile);

interface ActiveJob {
  overlay: WorkingOverlay;
  worker: WorkerHandle;
  leafLock: LeafLock;
}

export default class AgentSkillsPlugin extends Plugin {
  settings: AgentSkillsSettings = DEFAULT_SETTINGS;
  private readonly activeJobs = new Map<HTMLElement, ActiveJob>();
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AgentSkillsSettingTab(this));

    this.addRibbonIcon("wand-sparkles", "Run agent skill", () => {
      void this.openSkillPicker();
    });

    this.addCommand({
      id: "run-agent-skill",
      name: "Run agent skill…",
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file) return false;
        if (!checking) void this.openSkillPicker(view);
        return true;
      }
    });

    this.registerEvent(this.app.workspace.on(
      "editor-menu",
      (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        if (!(info instanceof MarkdownView) || !info.file) return;
        menu.addSeparator();
        menu.addItem((item) => item
          .setTitle("Run agent skill…")
          .setIcon("wand-sparkles")
          .onClick(() => {
            void this.openSkillPicker(info, editor.getSelection());
          }));
      }
    ));

    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.addClass("agent-skills-status-bar");
    this.updateStatusBar();
  }

  onunload(): void {
    for (const job of this.activeJobs.values()) {
      job.worker.cancel();
      job.leafLock.dispose();
      job.overlay.dispose();
    }
    this.activeJobs.clear();
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData() as Partial<AgentSkillsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async checkCodexInstallation(): Promise<string> {
    const binary = resolveCodexBinary(this.settings.codexPath);
    try {
      const { stdout, stderr } = await execFileAsync(binary, ["--version"], { timeout: 10000 });
      const version = (stdout || stderr).trim();
      return version ? `Codex is ready: ${version}` : `Codex is ready at ${binary}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Codex check failed at ${binary}: ${message}`;
    }
  }

  private getVaultRoot(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  private async openSkillPicker(view?: MarkdownView, capturedSelection?: string): Promise<void> {
    const markdownView = view ?? this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!markdownView?.file) {
      new Notice("Open a Markdown note before running an agent skill.");
      return;
    }

    const vaultRoot = this.getVaultRoot();
    if (!vaultRoot) {
      new Notice("Agent Skills requires a local desktop vault.");
      return;
    }

    if (this.activeJobs.has(markdownView.contentEl)) {
      new Notice("An agent skill is already running on this note.");
      return;
    }

    const skills = await discoverSkills(vaultRoot, this.settings);
    if (skills.length === 0) {
      new Notice("No skills found in .agents/skills. Add a SKILL.md or configure another skill root.", 7000);
      return;
    }

    const selection = capturedSelection ?? markdownView.editor.getSelection();
    new SkillPickerModal(this.app, skills, (skill) => {
      void this.runSkill(markdownView, skill, selection, vaultRoot);
    }).open();
  }

  private async runSkill(
    view: MarkdownView,
    skill: SkillDefinition,
    selection: string,
    vaultRoot: string
  ): Promise<void> {
    if (!view.file || this.activeJobs.has(view.contentEl)) return;

    let worker: WorkerHandle | null = null;
    const notePath = view.file.path;
    let lastLockNoticeAt = 0;
    const leafLock = lockLeafToNote(view.leaf, notePath, () => {
      const now = Date.now();
      if (now - lastLockNoticeAt < 750) return;
      lastLockNoticeAt = now;
      new Notice(`${notePath} is locked while ${skill.name} is running. Cancel the action first.`, 5000);
    });
    const overlay = new WorkingOverlay(view.contentEl, skill.name, () => worker?.cancel());

    try {
      worker = startCodexWorker({
        vaultRoot,
        notePath,
        selection,
        skill,
        settings: this.settings
      }, (progress) => overlay.setStatus(progress.message));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      overlay.fail(message);
      leafLock.dispose();
      window.setTimeout(() => overlay.dispose(), 3000);
      new Notice(`Could not start ${skill.name}: ${message}`, 8000);
      return;
    }

    this.activeJobs.set(view.contentEl, { overlay, worker, leafLock });
    this.updateStatusBar();

    try {
      const result = await worker.result;
      if (result.cancelled) {
        overlay.cancelled();
        new Notice(`${skill.name} cancelled.`);
        window.setTimeout(() => overlay.dispose(), 700);
      } else {
        overlay.complete();
        const summary = this.summariseResult(result.finalMessage);
        new Notice(`${skill.name} finished${summary ? ` — ${summary}` : "."}`, 9000);
        window.setTimeout(() => overlay.dispose(), 1200);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      overlay.fail(this.summariseResult(message, 240) || "The worker stopped unexpectedly.");
      new Notice(`${skill.name} failed: ${this.summariseResult(message, 500)}`, 10000);
      window.setTimeout(() => overlay.dispose(), 3500);
    } finally {
      leafLock.dispose();
      this.activeJobs.delete(view.contentEl);
      this.updateStatusBar();
    }
  }

  private summariseResult(value: string, maxLength = 180): string {
    const plain = value
      .replace(/[`*_#>]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}…` : plain;
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const count = this.activeJobs.size;
    this.statusBarEl.toggleClass("is-active", count > 0);
    this.statusBarEl.setText(count > 0 ? `${count} agent skill${count === 1 ? "" : "s"} running` : "");
  }
}
