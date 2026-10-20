// Registry of editors holding unsaved edits, so navigation, undo and closing the tab can ask first.
// Plain module state (no React) so both the store and the components can use it.

/** Editor instance id → the id of the item it edits (undefined for forms that aren't about one item). */
const dirtyEditors = new Map<string, string | undefined>();

export const DISCARD_MESSAGE = 'You have unsaved changes. Leave without saving them?';

/** Records that an editor has unsaved edits (call again if the item it edits changes). */
export function markDraftDirty(editorId: string, itemId?: string): void {
  dirtyEditors.set(editorId, itemId);
}

/** Records that an editor has nothing unsaved any more (saved, cancelled or closed). */
export function clearDraftDirty(editorId: string): void {
  dirtyEditors.delete(editorId);
}

export function hasUnsavedChanges(): boolean {
  return dirtyEditors.size > 0;
}

/** Whether any open editor holds unsaved edits to this item. */
export function isDraftDirty(itemId: string): boolean {
  for (const id of dirtyEditors.values()) if (id === itemId) return true;
  return false;
}

/** True when nothing is unsaved, or the user agrees to throw the unsaved edits away. */
export function confirmDiscard(message: string = DISCARD_MESSAGE): boolean {
  return !hasUnsavedChanges() || globalThis.confirm(message);
}
