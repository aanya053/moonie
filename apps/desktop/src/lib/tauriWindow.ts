export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

export const setNativeWindowSize = async (expanded: boolean, mascotSize = 128): Promise<void> => {
  if (!isTauriEnvironment()) {
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_expanded', { expanded, mascotSize });
  } catch (err) {
    console.warn('Failed to resize native Tauri window via command, trying webviewWindow API:', err);
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const { LogicalSize } = await import('@tauri-apps/api/dpi');
      const appWindow = getCurrentWebviewWindow();
      if (expanded) {
        await appWindow.setSize(new LogicalSize(360, 520));
      } else {
        await appWindow.setSize(new LogicalSize(mascotSize + 16, mascotSize + 16));
      }
    } catch (fallbackErr) {
      console.error('Failed to set native window size:', fallbackErr);
    }
  }
};

export const startNativeDrag = async (): Promise<void> => {
  if (!isTauriEnvironment()) {
    return;
  }

  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const appWindow = getCurrentWebviewWindow();
    await appWindow.startDragging();
  } catch (err) {
    console.warn('Failed to start native drag:', err);
  }
};
