import React from 'react';
import { Check, Play, Sparkles } from 'lucide-react';
import { MoonieMascot } from './MoonieMascot';
import type { Recommendation } from '../lib/recommendation';

interface RecommendationCardProps { recommendation: Recommendation; isMutating: boolean; onStart: (taskId: string) => void; onComplete: (taskId: string) => void; overwhelmed?: boolean; onExitOverwhelmed?: () => void; }

export const RecommendationCard: React.FC<RecommendationCardProps> = ({ recommendation, isMutating, onStart, onComplete, overwhelmed = false, onExitOverwhelmed }) => {
  const task = recommendation.task;
  return <section className={overwhelmed ? 'recommendation-card overwhelmed-card' : 'recommendation-card'} aria-labelledby="recommendation-heading">
    <div className="recommendation-mascot"><MoonieMascot isExpanded onToggle={() => undefined} pose={task ? 'thinking' : 'encouraging'} size={overwhelmed ? 72 : 54} decorative /></div>
    <div className="recommendation-copy"><div className="recommendation-label"><Sparkles size={13} />{overwhelmed ? 'One gentle next step' : 'What should I do now?'}</div>{task ? <><h3 id="recommendation-heading">{task.title}</h3><p>{recommendation.reason}</p><div className="recommendation-actions">{task.status === 'pending' && <button type="button" className="action-button primary" disabled={isMutating || task.is_blocked} onClick={() => onStart(task.id)}><Play size={13} />Start</button>}{['in_progress', 'snoozed'].includes(task.status) && <button type="button" className="action-button primary" disabled={isMutating} onClick={() => onComplete(task.id)}><Check size={13} />Complete</button>}{overwhelmed && onExitOverwhelmed && <button type="button" className="action-button" onClick={onExitOverwhelmed}>Show all tasks</button>}</div></> : <><h3 id="recommendation-heading">Nothing needs choosing right now.</h3><p>{recommendation.reason}</p>{overwhelmed && onExitOverwhelmed && <button type="button" className="action-button" onClick={onExitOverwhelmed}>Return to tasks</button>}</>}</div>
  </section>;
};
