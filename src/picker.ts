import { App, FuzzySuggestModal, setIcon, type FuzzyMatch } from "obsidian";
import type { SkillDefinition } from "./types";

export class SkillPickerModal extends FuzzySuggestModal<SkillDefinition> {
  constructor(
    app: App,
    private readonly skills: SkillDefinition[],
    private readonly choose: (skill: SkillDefinition) => void
  ) {
    super(app);
    this.setPlaceholder("Choose an agent skill…");
    this.setInstructions([
      { command: "↑↓", purpose: "navigate" },
      { command: "↵", purpose: "run skill" },
      { command: "esc", purpose: "close" }
    ]);
  }

  getItems(): SkillDefinition[] {
    return this.skills;
  }

  getItemText(skill: SkillDefinition): string {
    return `${skill.name} ${skill.description}`;
  }

  renderSuggestion(match: FuzzyMatch<SkillDefinition>, el: HTMLElement): void {
    const skill = match.item;
    el.addClass("agent-skills-suggestion");
    const icon = el.createDiv({ cls: "agent-skills-suggestion-icon" });
    setIcon(icon, "wand-sparkles");
    const copy = el.createDiv({ cls: "agent-skills-suggestion-copy" });
    const titleRow = copy.createDiv({ cls: "agent-skills-suggestion-title-row" });
    titleRow.createSpan({ cls: "agent-skills-suggestion-name", text: skill.name });
    titleRow.createSpan({ cls: "agent-skills-suggestion-source", text: skill.source });
    copy.createDiv({ cls: "agent-skills-suggestion-description", text: skill.description });
  }

  onChooseItem(skill: SkillDefinition): void {
    this.choose(skill);
  }
}
