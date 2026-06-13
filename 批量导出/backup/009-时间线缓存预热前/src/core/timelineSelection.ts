export function computeNextSelection(
  orderedIds: string[],
  currentSelection: string[],
  clickedId: string,
  anchorId: string | null,
  modifiers: { ctrlKey: boolean; shiftKey: boolean }
): { selection: string[]; anchorId: string } {
  if (modifiers.shiftKey && anchorId) {
    const startIndex = orderedIds.indexOf(anchorId);
    const endIndex = orderedIds.indexOf(clickedId);

    if (startIndex >= 0 && endIndex >= 0) {
      const [from, to] = startIndex <= endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      return {
        selection: orderedIds.slice(from, to + 1),
        anchorId
      };
    }
  }

  if (modifiers.ctrlKey) {
    const exists = currentSelection.includes(clickedId);
    return {
      selection: exists ? currentSelection.filter((id) => id !== clickedId) : [...currentSelection, clickedId],
      anchorId: clickedId
    };
  }

  return {
    selection: [clickedId],
    anchorId: clickedId
  };
}
