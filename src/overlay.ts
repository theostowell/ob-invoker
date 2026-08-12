import { setIcon } from "obsidian";

export class WorkingOverlay {
  private readonly overlayEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly detailEl: HTMLDivElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly elapsedEl: HTMLSpanElement;
  private readonly lockedChildren = new Map<HTMLElement, boolean>();
  private readonly startedAt = Date.now();
  private readonly elapsedTimer: number;
  private disposed = false;

  constructor(
    private readonly targetEl: HTMLElement,
    skillName: string,
    onCancel: () => void
  ) {
    for (const child of Array.from(targetEl.children)) {
      if (!(child instanceof HTMLElement)) continue;
      this.lockedChildren.set(child, child.inert);
      child.inert = true;
    }

    targetEl.addClass("agent-skills-running");
    targetEl.setAttribute("aria-busy", "true");
    this.overlayEl = targetEl.createDiv({ cls: "agent-skills-overlay" });
    const card = this.overlayEl.createDiv({ cls: "agent-skills-working-card" });
    const mark = card.createDiv({ cls: "agent-skills-working-mark" });
    const spinner = mark.createDiv({ cls: "agent-skills-spinner" });
    spinner.setAttribute("aria-hidden", "true");

    const heading = card.createDiv({ cls: "agent-skills-working-heading" });
    heading.createDiv({ cls: "agent-skills-working-kicker", text: "AGENT SKILL" });
    heading.createEl("h3", { text: skillName });

    this.statusEl = card.createDiv({ cls: "agent-skills-working-status", text: "Starting worker…" });
    this.detailEl = card.createDiv({
      cls: "agent-skills-working-detail",
      text: "This note is locked until the action finishes."
    });

    const footer = card.createDiv({ cls: "agent-skills-working-footer" });
    const elapsedWrap = footer.createDiv({ cls: "agent-skills-elapsed-wrap" });
    const clockIcon = elapsedWrap.createSpan({ cls: "agent-skills-clock-icon" });
    setIcon(clockIcon, "clock-3");
    this.elapsedEl = elapsedWrap.createSpan({ text: "0:00" });
    this.cancelButton = footer.createEl("button", {
      cls: "agent-skills-cancel-button",
      text: "Cancel"
    });
    this.cancelButton.addEventListener("click", () => onCancel());

    this.elapsedTimer = window.setInterval(() => this.updateElapsed(), 1000);
  }

  setStatus(message: string): void {
    if (!this.disposed) this.statusEl.setText(message);
  }

  complete(): void {
    if (this.disposed) return;
    this.overlayEl.addClass("is-complete");
    this.statusEl.setText("Done");
    this.detailEl.setText("Changes are ready.");
    this.cancelButton.hide();
  }

  cancelled(): void {
    if (this.disposed) return;
    this.overlayEl.addClass("is-cancelled");
    this.statusEl.setText("Cancelled");
    this.detailEl.setText("The worker has been stopped.");
    this.cancelButton.hide();
  }

  fail(message: string): void {
    if (this.disposed) return;
    this.overlayEl.addClass("is-failed");
    this.statusEl.setText("Action failed");
    this.detailEl.setText(message);
    this.cancelButton.hide();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.clearInterval(this.elapsedTimer);
    this.overlayEl.remove();
    for (const [child, wasInert] of this.lockedChildren) child.inert = wasInert;
    this.targetEl.removeClass("agent-skills-running");
    this.targetEl.removeAttribute("aria-busy");
  }

  private updateElapsed(): void {
    const elapsedSeconds = Math.floor((Date.now() - this.startedAt) / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = String(elapsedSeconds % 60).padStart(2, "0");
    this.elapsedEl.setText(`${minutes}:${seconds}`);
  }
}
