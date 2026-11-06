import type {
  FastApiValidationError,
  SnoozeRequest,
  Task,
  TaskCreate,
  TaskFilters,
  TaskUpdate,
  Dependency,
  RecurringRule,
  RecurringRuleCreate,
  RecurringRuleUpdate,
  BrainDumpResponse,
} from '../types/backend';
import { isTauriEnvironment } from './tauriWindow.ts';

type ApiErrorPayload = {
  detail?: string | FastApiValidationError[];
};

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const API_BASE_URL = viteEnv?.VITE_MOONIE_API_URL ?? 'http://127.0.0.1:8000';

let resolvedBaseUrl: Promise<string> | undefined;

async function backendBaseUrl(): Promise<string> {
  if (!isTauriEnvironment()) return API_BASE_URL;
  resolvedBaseUrl ??= import('@tauri-apps/api/core').then(({ invoke }) => invoke<string>('get_backend_url'));
  return resolvedBaseUrl;
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: 'network' | 'http' | 'invalid_response' | 'cancelled';

  constructor(
    message: string,
    options: {
      status?: number | null;
      kind: ApiError['kind'];
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status ?? null;
    this.kind = options.kind;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(payload: ApiErrorPayload | null): string {
  if (!payload?.detail) {
    return 'Moonie returned an unexpected error.';
  }
  if (typeof payload.detail === 'string') {
    return payload.detail;
  }
  return payload.detail
    .map((item) => item.msg)
    .filter((message): message is string => Boolean(message))
    .join(' ');
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('[Moonie] backend returned an unreadable response', { status: response.status });
    throw new ApiError('Moonie returned an unreadable response.', {
      kind: 'invalid_response',
      status: response.status,
      cause: error,
    });
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options;
  let response: Response;
  try {
    response = await fetch(`${await backendBaseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.warn('[Moonie] backend request failed', { kind: isAbortError(error) ? 'cancelled' : 'network', path });
    if (isAbortError(error)) {
      throw new ApiError('Request cancelled.', { kind: 'cancelled', cause: error });
    }
    throw new ApiError('Moonie is unavailable right now. Please try again.', {
      kind: 'network',
      cause: error,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await parseJson(response);
  if (!response.ok) {
    throw new ApiError(errorMessage(payload as ApiErrorPayload | null), {
      status: response.status,
      kind: 'http',
    });
  }
  return payload as T;
}

export interface MoonieApi {
  health(signal?: AbortSignal): Promise<{ status: string; service: string; version: string }>;
  listTasks(filters?: TaskFilters, signal?: AbortSignal): Promise<Task[]>;
  createTask(input: TaskCreate, signal?: AbortSignal): Promise<Task>;
  updateTask(taskId: string, input: TaskUpdate, signal?: AbortSignal): Promise<Task>;
  deleteTask(taskId: string, signal?: AbortSignal): Promise<void>;
  startTask(taskId: string, signal?: AbortSignal): Promise<Task>;
  completeTask(taskId: string, signal?: AbortSignal): Promise<Task>;
  reopenTask(taskId: string, signal?: AbortSignal): Promise<Task>;
  dropTask(taskId: string, signal?: AbortSignal): Promise<Task>;
  snoozeTask(taskId: string, input: SnoozeRequest, signal?: AbortSignal): Promise<Task>;
  addDependency(taskId: string, dependsOnTaskId: string, signal?: AbortSignal): Promise<Dependency>;
  removeDependency(taskId: string, dependsOnTaskId: string, signal?: AbortSignal): Promise<void>;
  listRecurringRules(signal?: AbortSignal): Promise<RecurringRule[]>;
  createRecurringRule(input: RecurringRuleCreate, signal?: AbortSignal): Promise<RecurringRule>;
  updateRecurringRule(ruleId: string, input: RecurringRuleUpdate, signal?: AbortSignal): Promise<RecurringRule>;
  deleteRecurringRule(ruleId: string, signal?: AbortSignal): Promise<void>;
  parseBrainDump(text: string, timezone?: string, signal?: AbortSignal): Promise<BrainDumpResponse>;
}

function withSignal(signal?: AbortSignal): RequestInit {
  return signal ? { signal } : {};
}

export const moonieApi: MoonieApi = {
  health: (signal) => request<{ status: string; service: string; version: string }>('/health', withSignal(signal)),
  listTasks: (filters = {}, signal) => {
    const query = new URLSearchParams();
    if (filters.status) query.set('status', filters.status);
    if (filters.task_type) query.set('task_type', filters.task_type);
    if (filters.include_completed !== undefined) {
      query.set('include_completed', String(filters.include_completed));
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<Task[]>(`/api/v1/tasks${suffix}`, withSignal(signal));
  },
  createTask: (input, signal) => request<Task>('/api/v1/tasks', { method: 'POST', body: input, ...withSignal(signal) }),
  updateTask: (taskId, input, signal) => request<Task>(`/api/v1/tasks/${taskId}`, { method: 'PATCH', body: input, ...withSignal(signal) }),
  deleteTask: (taskId, signal) => request<void>(`/api/v1/tasks/${taskId}`, { method: 'DELETE', ...withSignal(signal) }),
  startTask: (taskId, signal) => request<Task>(`/api/v1/tasks/${taskId}/start`, { method: 'POST', ...withSignal(signal) }),
  completeTask: (taskId, signal) => request<Task>(`/api/v1/tasks/${taskId}/complete`, { method: 'POST', ...withSignal(signal) }),
  reopenTask: (taskId, signal) => request<Task>(`/api/v1/tasks/${taskId}/reopen`, { method: 'POST', ...withSignal(signal) }),
  dropTask: (taskId, signal) => request<Task>(`/api/v1/tasks/${taskId}/drop`, { method: 'POST', ...withSignal(signal) }),
  snoozeTask: (taskId, input, signal) => request<Task>(`/api/v1/tasks/${taskId}/snooze`, { method: 'POST', body: input, ...withSignal(signal) }),
  addDependency: (taskId, dependsOnTaskId, signal) => request<Dependency>(`/api/v1/tasks/${taskId}/dependencies`, { method: 'POST', body: { depends_on_task_id: dependsOnTaskId }, ...withSignal(signal) }),
  removeDependency: (taskId, dependsOnTaskId, signal) => request<void>(`/api/v1/tasks/${taskId}/dependencies/${dependsOnTaskId}`, { method: 'DELETE', ...withSignal(signal) }),
  listRecurringRules: (signal) => request<RecurringRule[]>('/api/v1/recurring-rules', withSignal(signal)),
  createRecurringRule: (input, signal) => request<RecurringRule>('/api/v1/recurring-rules', { method: 'POST', body: input, ...withSignal(signal) }),
  updateRecurringRule: (ruleId, input, signal) => request<RecurringRule>(`/api/v1/recurring-rules/${ruleId}`, { method: 'PATCH', body: input, ...withSignal(signal) }),
  deleteRecurringRule: (ruleId, signal) => request<void>(`/api/v1/recurring-rules/${ruleId}`, { method: 'DELETE', ...withSignal(signal) }),
  parseBrainDump: (text, timezone, signal) => request<BrainDumpResponse>('/api/v1/brain-dump/parse', { method: 'POST', body: { text, timezone }, ...withSignal(signal) }),
};
