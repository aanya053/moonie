import { isTauriEnvironment } from './tauriWindow.ts';

export interface BackendStatus {
  url: string;
  managed: boolean;
  ready: boolean;
  error: string | null;
}

export async function getBackendStatus(): Promise<BackendStatus | null> {
  if (!isTauriEnvironment()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<BackendStatus>('get_backend_status');
  } catch {
    return null;
  }
}
