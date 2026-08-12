import type { TFile, View, ViewState, WorkspaceLeaf } from "obsidian";

export interface LeafLock {
  dispose: () => void;
}

function sameTargetNote(viewState: ViewState, notePath: string): boolean {
  const state = viewState.state;
  if (viewState.type !== "markdown" || !state || typeof state !== "object") return false;
  return (state as Record<string, unknown>).file === notePath;
}

/**
 * Temporarily prevents a leaf from being detached or navigated away from its
 * target note. Methods are patched on this leaf instance only and restored
 * exactly when the worker settles.
 */
export function lockLeafToNote(
  leaf: WorkspaceLeaf,
  notePath: string,
  onBlocked: () => void
): LeafLock {
  const originalDetach = leaf.detach;
  const originalOpen = leaf.open;
  const originalOpenFile = leaf.openFile;
  const originalSetViewState = leaf.setViewState;

  const hadOwnDetach = Object.hasOwn(leaf, "detach");
  const hadOwnOpen = Object.hasOwn(leaf, "open");
  const hadOwnOpenFile = Object.hasOwn(leaf, "openFile");
  const hadOwnSetViewState = Object.hasOwn(leaf, "setViewState");
  let disposed = false;

  leaf.detach = (): void => {
    onBlocked();
  };

  leaf.open = async (view: View): Promise<View> => {
    if (view === leaf.view) return originalOpen.call(leaf, view);
    onBlocked();
    return leaf.view;
  };

  leaf.openFile = async (file: TFile, openState): Promise<void> => {
    if (file.path === notePath) {
      await originalOpenFile.call(leaf, file, openState);
      return;
    }
    onBlocked();
  };

  leaf.setViewState = async (viewState: ViewState, eState?: unknown): Promise<void> => {
    if (sameTargetNote(viewState, notePath)) {
      await originalSetViewState.call(leaf, viewState, eState);
      return;
    }
    onBlocked();
  };

  const restore = <K extends "detach" | "open" | "openFile" | "setViewState">(
    key: K,
    original: WorkspaceLeaf[K],
    hadOwn: boolean
  ): void => {
    if (hadOwn) {
      Object.defineProperty(leaf, key, {
        configurable: true,
        writable: true,
        value: original
      });
    } else {
      delete (leaf as unknown as Record<string, unknown>)[key];
    }
  };

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      restore("detach", originalDetach, hadOwnDetach);
      restore("open", originalOpen, hadOwnOpen);
      restore("openFile", originalOpenFile, hadOwnOpenFile);
      restore("setViewState", originalSetViewState, hadOwnSetViewState);
    }
  };
}
