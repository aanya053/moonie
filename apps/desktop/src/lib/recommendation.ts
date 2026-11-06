import type { Task } from '../types/backend';

export interface Recommendation {
  task: Task | null;
  reason: string;
  secondary: Task | null;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function dueTime(task: Task): number | null {
  return timestamp(task.due_at) ?? timestamp(task.scheduled_at);
}

function reasonFor(task: Task, now: number): string {
  const due = timestamp(task.due_at);
  if (due !== null && due < now) return 'This deadline is overdue.';
  if (due !== null && due - now <= 24 * 60 * 60 * 1000) return 'This is due soon and nothing is blocking it.';
  if (task.scheduled_at && (timestamp(task.scheduled_at) ?? Infinity) <= now) return 'Your scheduled work is ready to begin.';
  if (task.status === 'in_progress') return 'You already started this—continuing is the gentlest next step.';
  return 'This is a small flexible task you can make progress on now.';
}

export function getRecommendation(tasks: Task[], now = new Date()): Recommendation {
  const nowTime = now.getTime();
  const eligible = tasks
    .filter((task) => !['completed', 'dropped'].includes(task.status))
    .filter((task) => !task.is_blocked)
    .filter((task) => task.status !== 'snoozed' || (timestamp(task.snoozed_until) ?? 0) <= nowTime)
    .filter((task) => (timestamp(task.scheduled_at) ?? 0) <= nowTime)
    .sort((left, right) => {
      const leftDue = dueTime(left);
      const rightDue = dueTime(right);
      const leftOverdue = leftDue !== null && leftDue < nowTime;
      const rightOverdue = rightDue !== null && rightDue < nowTime;
      const leftSoon = leftDue !== null && leftDue - nowTime <= 24 * 60 * 60 * 1000;
      const rightSoon = rightDue !== null && rightDue - nowTime <= 24 * 60 * 60 * 1000;
      const leftTier = leftOverdue ? 0 : leftSoon ? 1 : left.status === 'in_progress' ? 2 : left.task_type === 'deadline' ? 3 : 4;
      const rightTier = rightOverdue ? 0 : rightSoon ? 1 : right.status === 'in_progress' ? 2 : right.task_type === 'deadline' ? 3 : 4;
      return leftTier - rightTier
        || (leftDue ?? Number.MAX_SAFE_INTEGER) - (rightDue ?? Number.MAX_SAFE_INTEGER)
        || (left.estimated_minutes ?? Number.MAX_SAFE_INTEGER) - (right.estimated_minutes ?? Number.MAX_SAFE_INTEGER)
        || left.created_at.localeCompare(right.created_at)
        || left.id.localeCompare(right.id);
    });

  if (!eligible[0]) return { task: null, reason: 'There is no actionable task right now. Blocked, future-scheduled and snoozed work can wait.', secondary: null };
  return { task: eligible[0], reason: reasonFor(eligible[0], nowTime), secondary: eligible[1] ?? null };
}
