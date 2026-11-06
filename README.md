# Moonie

Moonie is a Windows desktop productivity companion with a floating mascot, task management, focus sessions, reminders, recurrence support, dependency-aware tasks, and an optional Brain Dump assistant.

## Features

- Floating, draggable mascot with click-to-expand behavior.
- Adjustable mascot size from 96px to 192px, persisted locally.
- Task creation, editing, deletion, filtering, and lifecycle actions.
- Task dependencies with circular-dependency validation.
- Recurring tasks with weekly and calendar-month recurrence.
- Snooze eligibility and desktop reminders.
- Local focus sessions with configurable focus and break durations.
- Brain Dump proposals that require explicit approval before tasks are saved.
- FastAPI backend with async SQLAlchemy and SQLite.
- Tauri v2 desktop shell with a supervised packaged backend.

## Architecture

```text
apps/
├── backend/       FastAPI, async SQLAlchemy, SQLite, recurrence and task services
└── desktop/       React + TypeScript + Vite frontend and Tauri v2 shell
```

In development, the frontend connects to a separately started backend on `127.0.0.1:8000`. Packaged builds can launch the bundled `moonie-backend.exe` on a dynamically selected loopback port and verify it with a per-process health token.

## Requirements

- Windows 10 or later
- Python 3.12
- Node.js and npm
- Rust toolchain with the Tauri v2 prerequisites

The backend virtual environment is expected at `apps/backend/.venv`.

## Development setup

### Backend

```powershell
cd D:\Projects\moonie\apps\backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start the development API:

```powershell
cd D:\Projects\moonie\apps\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The API is available at `http://127.0.0.1:8000`. Health check: `GET /health`. Interactive documentation is available at `/docs`.

### Desktop

```powershell
cd D:\Projects\moonie\apps\desktop
npm install
npm.cmd exec tauri -- dev
```

The desktop app expects the development backend to be running first. The existing floating window, global shortcut, tray behavior, dragging, and transparent shell are provided by Tauri.

## Configuration

Development configuration can be placed in `apps/backend/.env`. Copy the variable names from `apps/backend/.env.example`; do not commit secrets.

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_PATH` | SQLite database path | `apps/backend/moonie.db` in development |
| `ENVIRONMENT` | Runtime environment | `development` |
| `MOONIE_LLM_PROVIDER` | Brain Dump provider | unset |
| `MOONIE_LLM_API_KEY` | Backend-only provider key | unset |
| `MOONIE_LLM_BASE_URL` | OpenAI-compatible API base URL | OpenAI v1 URL |
| `MOONIE_LLM_MODEL` | Provider model name | `gpt-4o-mini` |

For packaged mode, backend configuration is loaded from `%LOCALAPPDATA%\Moonie\.env`, and the default production database is `%LOCALAPPDATA%\Moonie\moonie.db`. Never place provider credentials in React, Vite, Tauri frontend code, or source control.

## API areas

The backend uses the `/api/v1` prefix:

- `/api/v1/tasks` — task CRUD, lifecycle actions, and dependencies.
- `/api/v1/recurring-rules` — recurring-rule CRUD and schedule configuration.
- `/api/v1/brain-dump/parse` — provider-backed Brain Dump proposal generation.
- `/health` — backend health check.

Task lifecycle actions include start, complete, reopen, drop, and snooze. Brain Dump results are proposals only; tasks are created after the user approves selected proposals in the desktop UI.

## Testing and validation

Backend tests use isolated temporary SQLite databases:

```powershell
cd D:\Projects\moonie\apps\backend
.\.venv\Scripts\python.exe -m pytest -q
```

Frontend tests:

```powershell
cd D:\Projects\moonie\apps\desktop
npm run test
npm run lint
npm run build
```

Native Tauri checks:

```powershell
cd D:\Projects\moonie\apps\desktop\src-tauri
cargo check
cargo test
```

Tests do not require provider credentials or external services.

## Packaging

Build the bundled backend executable first:

```powershell
cd D:\Projects\moonie\apps\backend
.\build_backend.ps1
```

Then build the Tauri application:

```powershell
cd D:\Projects\moonie\apps\desktop
npm.cmd exec tauri -- build
```

The backend executable is included as a Tauri resource. The desktop supervisor selects a free loopback port, starts only the bundled backend it owns, waits for the authenticated health endpoint, and stops that process tree when Moonie closes.

## Data and safety

- SQLite databases, WAL files, virtual environments, build output, logs, and environment files are ignored by Git.
- The normal development and production databases must not be used for destructive test smoke checks.
- Existing data is preserved during startup migrations.
- Provider API keys are backend-only and must never be printed or exposed to the frontend.

## License

See [LICENSE](LICENSE).
