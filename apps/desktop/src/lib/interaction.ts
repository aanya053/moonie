export function isMoonieShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'code' | 'key'>): boolean {
  return event.ctrlKey && event.shiftKey && (event.code === 'Space' || event.key === ' ');
}

export function isPrimaryPointerClick(event: Pick<MouseEvent, 'button'>): boolean {
  return event.button === 0;
}
