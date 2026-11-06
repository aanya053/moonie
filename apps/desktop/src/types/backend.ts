export type TaskStatus = 'pending' | 'in_progress' | 'snoozed' | 'completed' | 'dropped';
export type TaskType = 'scheduled' | 'deadline' | 'recurring' | 'flexible';
export type EnergyLevel = 'low' | 'medium' | 'high';
export type SnoozePreset = 'later_today' | 'tomorrow_morning' | 'this_weekend' | 'next_week' | 'custom';

export interface Task {
  id: string;
  recurring_rule_id: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  task_type: TaskType;
  due_at: string | null;
  scheduled_at: string | null;
  snoozed_until: string | null;
  snooze_count: number;
  estimated_minutes: number | null;
  energy_level: EnergyLevel | null;
  completed_at: string | null;
  dropped_at: string | null;
  created_at: string;
  updated_at: string;
  is_blocked: boolean;
  prerequisite_ids: string[];
  dependent_ids: string[];
}

export interface TaskCreate {
  title: string;
  notes?: string | null;
  task_type?: TaskType;
  due_at?: string | null;
  scheduled_at?: string | null;
  estimated_minutes?: number | null;
  energy_level?: EnergyLevel | null;
  recurring_rule_id?: string | null;
  depends_on_task_ids?: string[] | null;
}

export interface TaskUpdate {
  title?: string;
  notes?: string | null;
  task_type?: TaskType;
  due_at?: string | null;
  scheduled_at?: string | null;
  estimated_minutes?: number | null;
  energy_level?: EnergyLevel | null;
}

export interface SnoozeRequest {
  preset: SnoozePreset;
  custom_until?: string | null;
}

export interface TaskFilters {
  status?: TaskStatus;
  task_type?: TaskType;
  include_completed?: boolean;
}

export interface Dependency {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

export type RecurrenceFrequency = 'daily' | 'weekly' | 'weekdays' | 'monthly';

export interface RecurringRuleCreate {
  title: string;
  frequency: RecurrenceFrequency;
  interval_val?: number;
  days_of_week?: number[] | null;
  time_of_day?: string | null;
  start_at?: string | null;
}

export interface RecurringRuleUpdate {
  title?: string;
  frequency?: RecurrenceFrequency;
  interval_val?: number;
  days_of_week?: number[] | null;
  time_of_day?: string | null;
}

export interface BrainDumpProposal {
  title: string;
  notes: string | null;
  task_type: TaskType;
  due_at: string | null;
  scheduled_at: string | null;
  estimated_minutes: number | null;
  energy_level: EnergyLevel | null;
  dependency_titles: string[];
  uncertainty: string[];
}

export interface BrainDumpResponse {
  provider: 'openai_compatible';
  proposals: BrainDumpProposal[];
}

export interface RecurringRule {
  id: string;
  title: string;
  frequency: 'daily' | 'weekly' | 'weekdays' | 'monthly';
  interval_val: number;
  days_of_week: number[] | null;
  time_of_day: string | null;
  next_trigger_at: string;
  created_at: string;
}

export interface FastApiValidationError {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
}
