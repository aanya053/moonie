import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { MoonieMascot } from './components/MoonieMascot';
import { ExpandedCompanion } from './components/ExpandedCompanion';
import { isTauriEnvironment, setNativeWindowSize } from './lib/tauriWindow';
import { loadSettings } from './lib/settings';
import { isMoonieShortcut } from './lib/interaction';
import { useBackgroundReminders } from './hooks/useBackgroundReminders';

export const App: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [settings, setSettings] = useState(() => loadSettings());
  const initialMascotSize = useRef(settings.mascotSize);
  const reminderNotice = useBackgroundReminders();

  useEffect(() => { void setNativeWindowSize(false, initialMascotSize.current); }, [initialMascotSize]);

  const toggleExpanded = useCallback(async () => {
    const nextState = !isExpanded;
    setIsExpanded(nextState);
    await setNativeWindowSize(nextState, settings.mascotSize);
  }, [isExpanded, settings.mascotSize]);

  const expandMoonie = useCallback(async () => {
    setIsExpanded(true);
    await setNativeWindowSize(true, settings.mascotSize);
  }, [settings.mascotSize]);

  const collapseMoonie = useCallback(async () => {
    setIsExpanded(false);
    await setNativeWindowSize(false, settings.mascotSize);
  }, [settings.mascotSize]);

  const handleMascotSizeChange = useCallback((mascotSize: number) => {
    setSettings((current) => ({ ...current, mascotSize }));
  }, []);

  // Listen for hotkeys and Tauri events
  useEffect(() => {
    // 1. Browser/Webview Fallback Hotkey: Ctrl+Shift+Space
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isMoonieShortcut(e)) {
        e.preventDefault();
        toggleExpanded();
      }
      if (e.key === 'Escape' && isExpanded) {
        collapseMoonie();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 2. Tauri IPC Event Listeners (from System Tray and Global Shortcut)
    let unlistenToggle: (() => void) | undefined;
    let unlistenExpand: (() => void) | undefined;

    if (isTauriEnvironment()) {
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('toggle-moonie', () => {
          toggleExpanded();
        }).then((unlisten) => {
          unlistenToggle = unlisten;
        });

        listen('expand-moonie', () => {
          expandMoonie();
        }).then((unlisten) => {
          unlistenExpand = unlisten;
        });
      });
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenToggle) unlistenToggle();
      if (unlistenExpand) unlistenExpand();
    };
  }, [toggleExpanded, expandMoonie, collapseMoonie, isExpanded]);

  return (
    <main className="w-screen h-screen flex items-center justify-center p-0 m-0 bg-transparent overflow-hidden select-none font-sans">
      <AnimatePresence mode="wait">
        {!isExpanded ? (
          // Idle State: ~64x64 Mascot Pod
          <div
            key="idle-pod"
            data-tauri-drag-region
            style={{ width: settings.mascotSize + 16, height: settings.mascotSize + 16 }}
            className="mascot-pod flex items-center justify-center cursor-move"
          >
            <MoonieMascot
              isExpanded={false}
              onToggle={toggleExpanded}
              pose="idle"
              size={settings.mascotSize}
            />
          </div>
        ) : (
          // Expanded State: ~360x520 Glassmorphic Companion
          <div key="expanded-pod" className="w-[360px] h-[520px] p-1.5 flex flex-col">
            <ExpandedCompanion onCollapse={collapseMoonie} onMascotSizeChange={handleMascotSizeChange} backgroundNotice={reminderNotice} />
          </div>
        )}
      </AnimatePresence>
    </main>
  );
};

export default App;
