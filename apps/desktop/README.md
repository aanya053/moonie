# Moonie desktop

## Prompt 4 lifecycle notes

- Reminders are polled by `useBackgroundReminders` while the React app is running, including when the floating window is collapsed. Eligible due or scheduled tasks are checked every 30 seconds. Completed, dropped, blocked and future-snoozed tasks are ignored.
- Reminder occurrences are keyed by task ID, reminder kind and timestamp, and stored in `localStorage`. A restart may deliver one reminder only when it is no more than 15 minutes late; older reminders are skipped so Moonie does not burst stale notifications. A snooze changes eligibility until its wake time. Notification permission is requested explicitly from Focus settings.
- Tauri uses the native Windows notification plugin; browser/WebView notifications remain the development fallback. Permission failures are reported without crashing, and reminders are marked delivered only after the notification call succeeds.
- The desktop bundle does not currently supervise or package the Python backend. Development runs FastAPI as a separate loopback process; a Windows installer must either launch a separately installed backend or add a tested signed sidecar in a later milestone.
- Development defaults to `apps/backend/moonie.db` (or an explicit `DATABASE_PATH`). With `ENVIRONMENT=production` and no explicit path, the backend stores data at `%LOCALAPPDATA%\\Moonie\\moonie.db`; the parent directory is created automatically.
- To build the packaged backend, run `cd D:\\Projects\\moonie\\apps\\backend; .\\build_backend.ps1`; this produces `apps/desktop/src-tauri/resources/moonie-backend.exe`. Run that command before `npm.cmd exec tauri -- build --debug` or a release build. The installer embeds the executable as a Tauri resource.
- The packaged backend uses a per-process loopback health handshake, a free `127.0.0.1` port, and `MOONIE_HEALTH_TOKEN`; it does not accept an unrelated service that happens to answer on the selected port. Development mode has no packaged resource and continues to use the separately started backend on port 8000.
- Recurrence generation runs in the FastAPI lifespan scheduler every 30 seconds while the backend is running. It generates at most one catch-up occurrence per enabled rule, advances the rule beyond the current time, and skips an occurrence when an active instance already exists. Scheduler failures are isolated per pass and retried on the next pass. No recurrence work occurs after the backend exits.
- Existing databases receive only an additive `recurring_rules.enabled` column migration at startup. No data is deleted. Rules can be enabled or disabled through the existing recurring-rule update API.
- Focus sessions are local-only. The default is 25 minutes focus and 5 minutes break. State is stored in `localStorage`, timestamps determine the countdown, and an expired running session is marked completed after reload without changing task state. The session pauses explicitly; collapsing the window does not stop it.
- The floating mascot defaults to 128 px and can be adjusted from Focus settings between 96 px and 192 px. The preference is stored in `localStorage`; the native transparent window is resized to match it, and the mascot button remains a no-drag click target while the surrounding pod remains draggable.
- Brain Dump credentials remain backend-only. Development loads `apps/backend/.env`; packaged mode loads `%LOCALAPPDATA%\\Moonie\\.env`. Copy the keys from `apps/backend/.env.example` into the appropriate local file, never into React/Vite settings or source control. The backend returns a configuration error when no provider is available; Brain Dump never saves tasks until proposals are explicitly approved.

## Development

Start the backend and desktop separately:

```powershell
cd D:\Projects\moonie\apps\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
cd D:\Projects\moonie\apps\desktop
npm.cmd run tauri dev
```
