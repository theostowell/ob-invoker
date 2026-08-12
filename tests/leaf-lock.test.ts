import assert from "node:assert/strict";
import test from "node:test";
import type { TFile, View, ViewState, WorkspaceLeaf } from "obsidian";
import { lockLeafToNote } from "../src/leaf-lock";

interface FakeLeafState {
  detached: number;
  openedFiles: string[];
  openedViews: unknown[];
  viewStates: ViewState[];
}

function createFakeLeaf(): { leaf: WorkspaceLeaf; state: FakeLeafState } {
  const state: FakeLeafState = {
    detached: 0,
    openedFiles: [],
    openedViews: [],
    viewStates: []
  };
  const currentView = { id: "current" } as unknown as View;
  const fake = {
    view: currentView,
    detach(): void {
      state.detached += 1;
    },
    async open(view: View): Promise<View> {
      state.openedViews.push(view);
      return view;
    },
    async openFile(file: TFile): Promise<void> {
      state.openedFiles.push(file.path);
    },
    async setViewState(viewState: ViewState): Promise<void> {
      state.viewStates.push(viewState);
    }
  };
  return { leaf: fake as unknown as WorkspaceLeaf, state };
}

test("a locked leaf cannot detach, replace its view, or open another file", async () => {
  const { leaf, state } = createFakeLeaf();
  let blocked = 0;
  const lock = lockLeafToNote(leaf, "Target.md", () => { blocked += 1; });

  leaf.detach();
  await leaf.open({ id: "replacement" } as unknown as View);
  await leaf.openFile({ path: "Other.md" } as TFile);
  await leaf.setViewState({ type: "markdown", state: { file: "Other.md" } });
  await leaf.setViewState({ type: "empty", state: {} });

  assert.equal(blocked, 5);
  assert.equal(state.detached, 0);
  assert.deepEqual(state.openedViews, []);
  assert.deepEqual(state.openedFiles, []);
  assert.deepEqual(state.viewStates, []);
  lock.dispose();
});

test("a locked leaf still permits operations that retain the target note", async () => {
  const { leaf, state } = createFakeLeaf();
  const lock = lockLeafToNote(leaf, "Target.md", () => assert.fail("should not block"));

  await leaf.open(leaf.view);
  await leaf.openFile({ path: "Target.md" } as TFile);
  await leaf.setViewState({ type: "markdown", state: { file: "Target.md", mode: "source" } });

  assert.equal(state.openedViews.length, 1);
  assert.deepEqual(state.openedFiles, ["Target.md"]);
  assert.equal(state.viewStates.length, 1);
  lock.dispose();
});

test("disposing the lock restores the leaf methods", async () => {
  const { leaf, state } = createFakeLeaf();
  const lock = lockLeafToNote(leaf, "Target.md", () => undefined);

  lock.dispose();
  lock.dispose();
  leaf.detach();
  await leaf.openFile({ path: "Other.md" } as TFile);
  await leaf.setViewState({ type: "empty", state: {} });

  assert.equal(state.detached, 1);
  assert.deepEqual(state.openedFiles, ["Other.md"]);
  assert.equal(state.viewStates.length, 1);
});
