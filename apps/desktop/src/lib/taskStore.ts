import { ApiError, moonieApi, type MoonieApi } from './api.ts';
import { isToday, isUpcoming } from './dateTime.ts';
import type { RecurringRule, RecurringRuleCreate, RecurringRuleUpdate, SnoozeRequest, Task, TaskCreate, TaskUpdate } from '../types/backend';

export type TaskView = 'actionable' | 'today' | 'upcoming' | 'completed' | 'dropped' | 'snoozed';

export interface TaskStoreState {
  tasks: Task[];
  isLoading: boolean;
  isRefreshing: boolean;
  isMutating: boolean;
  error: string | null;
  feedback: string | null;
  view: TaskView;
  recurringRules: RecurringRule[];
  isLoadingRules: boolean;
}

const initialState: TaskStoreState = {
  tasks: [],
  isLoading: false,
  isRefreshing: false,
  isMutating: false,
  error: null,
  feedback: null,
  view: 'actionable',
  recurringRules: [],
  isLoadingRules: false,
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Moonie could not complete that request.';
}

function filtersForView(view: TaskView) {
  if (view === 'completed' || view === 'dropped' || view === 'snoozed') return { status: view, include_completed: true } as const;
  return {};
}

function taskDate(task: Task): string | null {
  return task.due_at ?? task.scheduled_at;
}

function tasksForView(tasks: Task[], view: TaskView): Task[] {
  if (view === 'today') return tasks.filter((task) => isToday(taskDate(task)));
  if (view === 'upcoming') return tasks.filter((task) => isUpcoming(taskDate(task)));
  return tasks;
}

export class TaskStore {
  private readonly api: MoonieApi;
  private state: TaskStoreState = initialState;
  private listeners = new Set<() => void>();
  private requestVersion = 0;
  private requestController: AbortController | null = null;
  private mutationPromise: Promise<boolean> | null = null;

  constructor(api: MoonieApi = moonieApi) {
    this.api = api;
  }

  getSnapshot = (): TaskStoreState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(patch: Partial<TaskStoreState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async load(refresh = false, view = this.state.view): Promise<boolean> {
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const version = ++this.requestVersion;
    this.setState({
      ...(refresh ? { isRefreshing: true } : { isLoading: true }),
      error: null,
    });

    try {
      const tasks = await this.api.listTasks(filtersForView(view), controller.signal);
      if (version !== this.requestVersion) return false;
      this.setState({ tasks: tasksForView(tasks, view), view, isLoading: false, isRefreshing: false });
      return true;
    } catch (error) {
      if (version !== this.requestVersion || controller.signal.aborted) return false;
      this.setState({ error: messageFor(error), isLoading: false, isRefreshing: false });
      return false;
    }
  }

  setView(view: TaskView): Promise<boolean> {
    this.setState({ view });
    return this.load(false, view);
  }

  private async mutate(action: () => Promise<void>, successMessage: string): Promise<boolean> {
    if (this.mutationPromise) return false;
    this.setState({ isMutating: true, error: null, feedback: null });
    this.mutationPromise = (async () => {
      try {
        await action();
        const refreshed = await this.load(true);
        if (!refreshed) return false;
        this.setState({ feedback: successMessage });
        return true;
      } catch (error) {
        this.setState({ error: messageFor(error) });
        return false;
      } finally {
        this.mutationPromise = null;
        this.setState({ isMutating: false });
      }
    })();
    return this.mutationPromise;
  }

  createTask(input: TaskCreate): Promise<boolean> {
    return this.mutate(() => this.api.createTask(input).then(() => undefined), 'Task saved.');
  }

  updateTask(taskId: string, input: TaskUpdate): Promise<boolean> {
    return this.mutate(() => this.api.updateTask(taskId, input).then(() => undefined), 'Task updated.');
  }

  deleteTask(taskId: string): Promise<boolean> {
    return this.mutate(() => this.api.deleteTask(taskId), 'Task removed.');
  }

  startTask(taskId: string): Promise<boolean> {
    return this.mutate(() => this.api.startTask(taskId).then(() => undefined), 'Task started.');
  }

  completeTask(taskId: string): Promise<boolean> {
    return this.mutate(() => this.api.completeTask(taskId).then(() => undefined), 'Task completed.');
  }

  reopenTask(taskId: string): Promise<boolean> {
    return this.mutate(() => this.api.reopenTask(taskId).then(() => undefined), 'Task reopened.');
  }

  dropTask(taskId: string): Promise<boolean> {
    return this.mutate(() => this.api.dropTask(taskId).then(() => undefined), 'Task set aside.');
  }

  snoozeTask(taskId: string, input: SnoozeRequest): Promise<boolean> {
    return this.mutate(() => this.api.snoozeTask(taskId, input).then(() => undefined), 'Task snoozed.');
  }

  addDependency(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    return this.mutate(() => this.api.addDependency(taskId, dependsOnTaskId).then(() => undefined), 'Prerequisite added.');
  }

  removeDependency(taskId: string, dependsOnTaskId: string): Promise<boolean> {
    return this.mutate(() => this.api.removeDependency(taskId, dependsOnTaskId), 'Prerequisite removed.');
  }

  async loadRecurringRules(): Promise<boolean> {
    this.setState({ isLoadingRules: true, error: null });
    try {
      const recurringRules = await this.api.listRecurringRules();
      this.setState({ recurringRules, isLoadingRules: false });
      return true;
    } catch (error) {
      this.setState({ error: messageFor(error), isLoadingRules: false });
      return false;
    }
  }

  private async mutateRule(action: () => Promise<void>, successMessage: string): Promise<boolean> {
    if (this.mutationPromise) return false;
    this.setState({ isMutating: true, error: null, feedback: null });
    this.mutationPromise = (async () => {
      try {
        await action();
        if (!await this.loadRecurringRules()) return false;
        this.setState({ feedback: successMessage });
        return true;
      } catch (error) {
        this.setState({ error: messageFor(error) });
        return false;
      } finally {
        this.mutationPromise = null;
        this.setState({ isMutating: false });
      }
    })();
    return this.mutationPromise;
  }

  createRecurringRule(input: RecurringRuleCreate): Promise<boolean> {
    return this.mutateRule(() => this.api.createRecurringRule(input).then(() => undefined), 'Recurring rule saved.');
  }

  updateRecurringRule(ruleId: string, input: RecurringRuleUpdate): Promise<boolean> {
    return this.mutateRule(() => this.api.updateRecurringRule(ruleId, input).then(() => undefined), 'Recurring rule updated.');
  }

  deleteRecurringRule(ruleId: string): Promise<boolean> {
    return this.mutateRule(() => this.api.deleteRecurringRule(ruleId), 'Recurring rule removed.');
  }

  cancel(): void {
    this.requestController?.abort();
    this.requestVersion += 1;
  }
}
