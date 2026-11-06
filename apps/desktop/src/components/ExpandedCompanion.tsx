import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertCircle, Archive, Check, ChevronDown, Clock3, Compass, Heart, LoaderCircle,
  MessageSquare, Pencil, Play, Plus, RefreshCw, Repeat2, RotateCcw, Save, Sparkles,
  Trash2, X,
} from 'lucide-react';
import { MoonieMascot } from './MoonieMascot';
import { BrainDumpPanel } from './BrainDumpPanel';
import { RecommendationCard } from './RecommendationCard';
import { FocusSessionPanel } from './FocusSessionPanel';
import { useTasks } from '../hooks/useTasks';
import { fromApiDateTime, toApiDateTime } from '../lib/dateTime';
import type { RecurrenceFrequency, Task, TaskType, EnergyLevel } from '../types/backend';
import type { TaskView } from '../lib/taskStore';
import { getRecommendation } from '../lib/recommendation';
import type { FocusSession } from '../lib/focusSession';

interface ExpandedCompanionProps { onCollapse: () => void; onMascotSizeChange?: (size: number) => void; backgroundNotice?: string | null; }

const taskTypeOptions: Array<{ value: TaskType; label: string }> = [
  { value: 'flexible', label: 'Flexible' }, { value: 'deadline', label: 'Deadline' },
  { value: 'scheduled', label: 'Scheduled' }, { value: 'recurring', label: 'Recurring' },
];
const energyOptions: Array<{ value: EnergyLevel; label: string }> = [
  { value: 'low', label: 'Low energy' }, { value: 'medium', label: 'Medium energy' }, { value: 'high', label: 'High energy' },
];
const viewOptions: Array<{ value: TaskView; label: string }> = [
  { value: 'actionable', label: 'Actionable' }, { value: 'today', label: 'Today' }, { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' }, { value: 'dropped', label: 'Dropped' }, { value: 'snoozed', label: 'Snoozed' },
];
const frequencyOptions: Array<{ value: RecurrenceFrequency; label: string }> = [
  { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'weekdays', label: 'Weekdays' }, { value: 'monthly', label: 'Monthly' },
];
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatWhen(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function statusLabel(status: Task['status']): string { return status.replace('_', ' '); }

function TaskFields({ values, setValues }: { values: TaskFormValues; setValues: React.Dispatch<React.SetStateAction<TaskFormValues>> }) {
  return (
    <>
      <input aria-label="Task title" value={values.title} onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" maxLength={250} />
      <textarea aria-label="Task notes" value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes, links or context (optional)" rows={2} />
      <div className="form-grid">
        <label>Type<select aria-label="Task type" value={values.taskType} onChange={(event) => setValues((current) => ({ ...current, taskType: event.target.value as TaskType }))}>{taskTypeOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label>Energy<select aria-label="Energy level" value={values.energy} onChange={(event) => setValues((current) => ({ ...current, energy: event.target.value as EnergyLevel | '' }))}><option value="">Not set</option>{energyOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
        <label>Due time<input aria-label="Due date and time" type="datetime-local" value={values.dueAt} onChange={(event) => setValues((current) => ({ ...current, dueAt: event.target.value }))} /></label>
        <label>Scheduled time<input aria-label="Scheduled date and time" type="datetime-local" value={values.scheduledAt} onChange={(event) => setValues((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>
        <label>Minutes<input aria-label="Estimated minutes" type="number" min="1" step="1" value={values.estimatedMinutes} onChange={(event) => setValues((current) => ({ ...current, estimatedMinutes: event.target.value }))} placeholder="Optional" /></label>
      </div>
    </>
  );
}

interface TaskFormValues { title: string; notes: string; taskType: TaskType; dueAt: string; scheduledAt: string; estimatedMinutes: string; energy: EnergyLevel | ''; }
const blankTaskForm: TaskFormValues = { title: '', notes: '', taskType: 'flexible', dueAt: '', scheduledAt: '', estimatedMinutes: '', energy: '' };

export const ExpandedCompanion: React.FC<ExpandedCompanionProps> = ({ onCollapse, onMascotSizeChange, backgroundNotice = null }) => {
  const state = useTasks();
  const { tasks, view, isLoading, isRefreshing, isMutating, error, feedback, recurringRules } = state;
  const [createValues, setCreateValues] = useState<TaskFormValues>(blankTaskForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<TaskFormValues>(blankTaskForm);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [dependencyId, setDependencyId] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleFrequency, setRuleFrequency] = useState<RecurrenceFrequency>('weekly');
  const [ruleInterval, setRuleInterval] = useState('1');
  const [ruleDays, setRuleDays] = useState<number[]>([]);
  const [ruleTime, setRuleTime] = useState('09:00');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [brainDumpOpen, setBrainDumpOpen] = useState(false);
  const [overwhelmed, setOverwhelmed] = useState(false);
  const [focusSession, setFocusSession] = useState<FocusSession | null>(null);

  const mascotPose = error ? 'curious' : focusSession?.status === 'running' ? focusSession.mode === 'break' ? 'break' : 'working' : isLoading || isRefreshing || isMutating ? 'working' : feedback?.toLowerCase().includes('completed') ? 'celebrating' : feedback ? 'encouraging' : tasks.length === 0 ? 'curious' : 'idle';
  const emptyText = view === 'actionable' ? 'Nothing actionable here. You have room to breathe.' : `No ${view} tasks to show.`;
  const recommendation = getRecommendation(tasks);

  const payloadFor = (values: TaskFormValues) => ({
    title: values.title.trim(), notes: values.notes.trim() || null, task_type: values.taskType,
    due_at: toApiDateTime(values.dueAt), scheduled_at: toApiDateTime(values.scheduledAt),
    estimated_minutes: values.estimatedMinutes ? Number(values.estimatedMinutes) : null,
    energy_level: values.energy || null,
  });

  const submitTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!createValues.title.trim() || isMutating) return;
    const saved = await state.createTask(payloadFor(createValues));
    if (saved) setCreateValues(blankTaskForm);
  };

  const beginEdit = (task: Task) => {
    setEditingId(task.id);
    setEditValues({ title: task.title, notes: task.notes ?? '', taskType: task.task_type, dueAt: fromApiDateTime(task.due_at), scheduledAt: fromApiDateTime(task.scheduled_at), estimatedMinutes: task.estimated_minutes?.toString() ?? '', energy: task.energy_level ?? '' });
  };

  const saveEdit = async (taskId: string) => {
    if (!editValues.title.trim() || isMutating) return;
    if (await state.updateTask(taskId, payloadFor(editValues))) setEditingId(null);
  };

  const confirmDelete = async (task: Task) => {
    if (isMutating) return;
    if (typeof window === 'undefined' || window.confirm(`Remove “${task.title}”?`)) await state.deleteTask(task.id);
  };

  const addPrerequisite = async (task: Task) => {
    const id = dependencyId.trim();
    if (!id || id === task.id) return;
    if (await state.addDependency(task.id, id)) setDependencyId('');
  };

  const submitRule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const interval = Number(ruleInterval);
    if (!ruleTitle.trim() || !Number.isInteger(interval) || interval < 1 || isMutating) return;
    const input = { title: ruleTitle.trim(), frequency: ruleFrequency, interval_val: interval, days_of_week: ruleDays.length ? ruleDays : null, time_of_day: ruleTime || null };
    const saved = editingRuleId ? await state.updateRecurringRule(editingRuleId, input) : await state.createRecurringRule(input);
    if (saved) { setRuleTitle(''); setRuleInterval('1'); setRuleDays([]); setEditingRuleId(null); }
  };

  const editRule = (rule: typeof recurringRules[number]) => { setEditingRuleId(rule.id); setRuleTitle(rule.title); setRuleFrequency(rule.frequency); setRuleInterval(String(rule.interval_val)); setRuleDays(rule.days_of_week ?? []); setRuleTime(rule.time_of_day ?? ''); };

  return (
    <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="w-full h-full flex flex-col rounded-3xl bg-slate-900/90 backdrop-blur-xl border border-amber-300/20 text-slate-100 shadow-2xl overflow-hidden">
      <div data-tauri-drag-region className="flex items-center justify-between px-5 pt-3 pb-2 select-none cursor-move border-b border-white/5">
        <div data-tauri-drag-region className="flex items-center gap-2.5"><MoonieMascot key={mascotPose} isExpanded onToggle={onCollapse} pose={mascotPose} size={42} /><div><span className="font-semibold text-sm tracking-wide text-amber-200">Moonie</span><div className="flex items-center gap-1 text-[11px] text-amber-200/60"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /><span>{error ? 'Let’s reconnect gently' : 'A calm place for your next step'}</span></div></div></div>
        <div className="flex items-center gap-1"><button type="button" onClick={() => void state.refresh()} disabled={isRefreshing || isMutating} className="icon-button" title="Refresh tasks" aria-label="Refresh tasks"><RefreshCw size={15} className={isRefreshing ? 'spin' : undefined} /></button><button type="button" onClick={onCollapse} className="icon-button" title="Minimize Moonie" aria-label="Minimize Moonie"><X size={18} /></button></div>
      </div>

      <div className="flex-1 p-4 flex flex-col overflow-y-auto companion-scroll">
        <div className="welcome-card"><div className="flex items-center gap-2 text-amber-300 text-xs font-medium mb-1"><Sparkles size={14} /><span>Make a little space</span></div><p className="text-sm font-medium text-slate-200 leading-snug">You don&apos;t have to keep everything in your head. Start with one small thing.</p></div>{backgroundNotice && <div className="state-card state-error" role="status"><AlertCircle size={14} /><span>{backgroundNotice}</span></div>}

        {overwhelmed ? <RecommendationCard recommendation={recommendation} isMutating={isMutating} onStart={(taskId) => void state.startTask(taskId)} onComplete={(taskId) => void state.completeTask(taskId)} overwhelmed onExitOverwhelmed={() => setOverwhelmed(false)} /> : <>
        <RecommendationCard recommendation={recommendation} isMutating={isMutating} onStart={(taskId) => void state.startTask(taskId)} onComplete={(taskId) => void state.completeTask(taskId)} />
        <div className="mode-actions"><button type="button" className="action-button" onClick={() => setOverwhelmed(true)}>I&apos;m overwhelmed</button></div>
        <FocusSessionPanel tasks={tasks} onStateChange={setFocusSession} onMascotSizeChange={onMascotSizeChange} />
        <nav className="task-tabs" aria-label="Task views">{viewOptions.map((option) => <button type="button" key={option.value} className={view === option.value ? 'active' : ''} onClick={() => void state.setView(option.value)} disabled={isMutating}>{option.label}</button>)}</nav>
        <section className="task-section" aria-labelledby="tasks-heading"><div className="section-heading"><div><h3 id="tasks-heading" className="text-xs font-semibold text-slate-200">{viewOptions.find((option) => option.value === view)?.label} tasks</h3><span className="section-caption">Server-backed and refreshed after every change</span></div>{isRefreshing && <LoaderCircle size={14} className="spin text-amber-300" aria-label="Refreshing" />}</div>
          {isLoading ? <div className="state-card"><LoaderCircle size={18} className="spin" /><span>Gathering your tasks…</span></div> : error ? <div className="state-card state-error" role="alert"><AlertCircle size={18} /><div><span>{error}</span><button type="button" className="text-button" onClick={() => void state.refresh()}>Try again</button></div></div> : tasks.length === 0 ? <div className="state-card"><Check size={18} /><span>{emptyText}</span></div> : <div className="task-list">{tasks.map((task) => { const when = formatWhen(task.due_at ?? task.scheduled_at ?? task.snoozed_until); const editing = editingId === task.id; const expanded = expandedTaskId === task.id; return <article className="task-row" key={task.id}>
            {editing ? <div className="edit-form"><TaskFields values={editValues} setValues={setEditValues} /><div className="task-actions"><button type="button" className="action-button primary" disabled={isMutating || !editValues.title.trim()} onClick={() => void saveEdit(task.id)}><Save size={12} />Save</button><button type="button" className="action-button" disabled={isMutating} onClick={() => setEditingId(null)}>Cancel</button></div></div> : <>
              <div className="task-main"><div className="task-title-line"><span className="task-title">{task.title}</span>{task.task_type === 'recurring' && <Repeat2 size={13} className="text-amber-300" aria-label="Recurring" />}</div>{task.notes && <p className="task-notes">{task.notes}</p>}<div className="task-meta"><span className="task-status">{statusLabel(task.status)}</span><span>{task.task_type}</span>{task.estimated_minutes && <span>{task.estimated_minutes} min</span>}{task.energy_level && <span>{task.energy_level} energy</span>}{when && <span><Clock3 size={11} />{when}</span>}</div>{task.is_blocked && <div className="task-blocked"><AlertCircle size={11} />Blocked by {task.prerequisite_ids.length} prerequisite{task.prerequisite_ids.length === 1 ? '' : 's'}</div>}
                {expanded && <div className="task-details"><div className="dependency-list"><strong>Prerequisites</strong>{task.prerequisite_ids.length ? task.prerequisite_ids.map((id) => <span key={id} className="dependency-chip">{id.slice(0, 8)}<button type="button" onClick={() => void state.removeDependency(task.id, id)} aria-label={`Remove prerequisite ${id}`}>×</button></span>) : <span className="muted-detail">None recorded</span>}<div className="dependency-add"><input aria-label="Prerequisite task ID" value={dependencyId} onChange={(event) => setDependencyId(event.target.value)} placeholder="Task ID" /><button type="button" className="action-button" disabled={isMutating || !dependencyId.trim()} onClick={() => void addPrerequisite(task)}>Add</button></div><small>Dependencies use task IDs. Dropped prerequisites are not assumed to be satisfied.</small></div></div>}
              </div><div className="task-actions"><button type="button" className="icon-button" onClick={() => { setExpandedTaskId(expanded ? null : task.id); setDependencyId(''); }} title="Show task details" aria-label={`Show details for ${task.title}`}><ChevronDown size={13} className={expanded ? 'rotate-180' : undefined} /></button><button type="button" className="icon-button" disabled={isMutating} onClick={() => beginEdit(task)} title="Edit task" aria-label={`Edit ${task.title}`}><Pencil size={12} /></button>{task.status === 'pending' && <button type="button" className="action-button" disabled={isMutating || task.is_blocked} onClick={() => void state.startTask(task.id)}><Play size={12} />Start</button>}{['pending', 'in_progress', 'snoozed'].includes(task.status) && <button type="button" className="icon-button success" disabled={isMutating} onClick={() => void state.completeTask(task.id)} title="Complete task" aria-label={`Complete ${task.title}`}><Check size={13} /></button>}{['completed', 'dropped', 'snoozed'].includes(task.status) && <button type="button" className="icon-button" disabled={isMutating} onClick={() => void state.reopenTask(task.id)} title="Reopen task" aria-label={`Reopen ${task.title}`}><RotateCcw size={13} /></button>}{['pending', 'in_progress', 'snoozed'].includes(task.status) && <button type="button" className="icon-button" disabled={isMutating} onClick={() => void state.snoozeTask(task.id, { preset: 'tomorrow_morning' })} title="Snooze until tomorrow morning" aria-label={`Snooze ${task.title}`}><Clock3 size={13} /></button>}{['pending', 'in_progress', 'snoozed'].includes(task.status) && <button type="button" className="icon-button" disabled={isMutating} onClick={() => void state.dropTask(task.id)} title="Set aside task" aria-label={`Set aside ${task.title}`}><Archive size={13} /></button>}<button type="button" className="icon-button danger" disabled={isMutating} onClick={() => void confirmDelete(task)} title="Delete task" aria-label={`Delete ${task.title}`}><Trash2 size={12} /></button></div>
            </>}
          </article>; })}</div>}
        </section>

        <form className="task-create" onSubmit={(event) => void submitTask(event)}><div className="section-heading"><h3 className="text-xs font-semibold text-slate-200">Add something small</h3><Plus size={14} className="text-amber-300" /></div><TaskFields values={createValues} setValues={setCreateValues} /><div className="create-controls"><button type="submit" className="action-button primary create-button" disabled={isMutating || !createValues.title.trim()}>{isMutating ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />}Add task</button></div></form>

        <details className="recurrence-panel"><summary><span><Repeat2 size={14} />Recurring tasks</span><ChevronDown size={14} /></summary><div className="recurrence-content"><p className="section-caption">Rules generate instances through the existing backend operations.</p>{recurringRules.map((rule) => <div className="rule-row" key={rule.id}><div><strong>{rule.title}</strong><span>{rule.frequency} · every {rule.interval_val} · next {formatWhen(rule.next_trigger_at) ?? 'not scheduled'}</span></div><div className="task-actions"><button type="button" className="icon-button" onClick={() => editRule(rule)} aria-label={`Edit ${rule.title}`}><Pencil size={12} /></button><button type="button" className="icon-button danger" onClick={() => { if (window.confirm(`Remove recurring rule “${rule.title}”? Existing task instances are preserved.`)) void state.deleteRecurringRule(rule.id); }} aria-label={`Delete ${rule.title}`}><Trash2 size={12} /></button></div></div>)}<form className="rule-form" onSubmit={(event) => void submitRule(event)}><input aria-label="Recurring rule title" value={ruleTitle} onChange={(event) => setRuleTitle(event.target.value)} placeholder="Rule title" maxLength={200} /><div className="form-grid"><label>Frequency<select aria-label="Recurring frequency" value={ruleFrequency} onChange={(event) => setRuleFrequency(event.target.value as RecurrenceFrequency)}>{frequencyOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Every<input aria-label="Recurring interval" type="number" min="1" step="1" value={ruleInterval} onChange={(event) => setRuleInterval(event.target.value)} /></label><label>Time<input aria-label="Recurring time" type="time" value={ruleTime} onChange={(event) => setRuleTime(event.target.value)} /></label></div><div className="weekday-picker" aria-label="Recurring weekdays">{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={ruleDays.includes(index)} onChange={(event) => setRuleDays((current) => event.target.checked ? [...current, index].sort() : current.filter((value) => value !== index))} />{day}</label>)}</div><div className="task-actions"><button type="submit" className="action-button primary" disabled={isMutating || !ruleTitle.trim() || Number(ruleInterval) < 1}>{editingRuleId ? 'Update rule' : 'Add rule'}</button>{editingRuleId && <button type="button" className="action-button" onClick={() => { setEditingRuleId(null); setRuleTitle(''); }}>Cancel</button>}</div></form></div></details>

        {feedback && <div className="feedback" role="status">{feedback}</div>}{brainDumpOpen ? <BrainDumpPanel createTask={state.createTask} isMutating={isMutating} onClose={() => setBrainDumpOpen(false)} /> : <button type="button" className="placeholder-card placeholder-button" onClick={() => setBrainDumpOpen(true)}><div className="placeholder-icon"><MessageSquare size={14} /></div><div><span className="placeholder-title">Brain Dump</span><p>Turn a messy thought into tasks you can review before saving.</p></div></button>}<div className="placeholder-card"><div className="placeholder-icon"><Compass size={16} /></div><div><span className="placeholder-title">Recommendation logic</span><p>Moonie uses deadlines, schedules, dependencies and snoozes—never guesses.</p></div></div>
        </>}
      </div>
      <div className="pt-3 px-4 pb-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-400"><div className="flex items-center gap-1.5"><Heart size={12} className="text-pink-400" /><span>Gentle desktop companion</span></div><kbd className="px-2 py-0.5 rounded bg-white/10 text-[10px] text-amber-200 font-mono">Ctrl+Shift+Space</kbd></div>
    </motion.div>
  );
};
