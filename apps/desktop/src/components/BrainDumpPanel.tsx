import React, { useState } from 'react';
import { Brain, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { moonieApi, ApiError } from '../lib/api';
import { fromApiDateTime, toApiDateTime } from '../lib/dateTime';
import type { BrainDumpProposal, TaskCreate } from '../types/backend';

interface BrainDumpPanelProps { createTask: (input: TaskCreate) => Promise<boolean>; isMutating: boolean; onClose: () => void; }

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Moonie could not parse that thought.';
}

export const BrainDumpPanel: React.FC<BrainDumpPanelProps> = ({ createTask, isMutating, onClose }) => {
  const [text, setText] = useState('');
  const [proposals, setProposals] = useState<BrainDumpProposal[]>([]);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const parse = async () => {
    if (!text.trim() || isParsing) return;
    setIsParsing(true); setError(null); setFeedback(null);
    try {
      const result = await moonieApi.parseBrainDump(text.trim(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      setProposals(result.proposals); setSelected(result.proposals.map(() => true));
      if (result.proposals.length === 0) setFeedback('Moonie found no clear tasks. Your thought is still safe here.');
    } catch (parseError) { setError(messageFor(parseError)); }
    finally { setIsParsing(false); }
  };

  const approve = async () => {
    if (isApproving || isMutating) return;
    const selectedProposals = proposals.map((proposal, index) => ({ proposal, index })).filter((item) => selected[item.index]);
    if (!selectedProposals.length) { setError('Choose at least one proposal to save.'); return; }
    setIsApproving(true); setError(null); setFeedback(null);
    let saved = 0;
    for (const { proposal } of selectedProposals) {
      const task: TaskCreate = {
        title: proposal.title.trim(), notes: proposal.notes?.trim() || null, task_type: proposal.task_type,
        due_at: proposal.due_at, scheduled_at: proposal.scheduled_at, estimated_minutes: proposal.estimated_minutes, energy_level: proposal.energy_level,
      };
      if (!task.title || !(await createTask(task))) break;
      saved += 1;
    }
    if (saved === selectedProposals.length) { setFeedback(`${saved} task${saved === 1 ? '' : 's'} saved after your review.`); setProposals([]); setSelected([]); }
    else if (saved > 0) setError(`${saved} task${saved === 1 ? '' : 's'} saved. The remaining proposals are still here for retry.`);
    setIsApproving(false);
  };

  const updateProposal = (index: number, patch: Partial<BrainDumpProposal>) => setProposals((current) => current.map((proposal, itemIndex) => itemIndex === index ? { ...proposal, ...patch } : proposal));

  return <section className="brain-dump-panel" aria-labelledby="brain-dump-heading">
    <div className="panel-heading"><div><h3 id="brain-dump-heading"><Brain size={15} />Brain Dump</h3><p>Write it messily. Review everything before Moonie saves anything.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close Brain Dump"><X size={16} /></button></div>
    <textarea aria-label="Brain Dump text" value={text} onChange={(event) => setText(event.target.value)} placeholder="I need to…" rows={5} disabled={isParsing || isApproving} />
    <button type="button" className="action-button primary" onClick={() => void parse()} disabled={isParsing || !text.trim()}>{isParsing ? <LoaderCircle size={13} className="spin" /> : <Sparkles size={13} />}Parse thought</button>
    {error && <div className="brain-dump-error" role="alert">{error}</div>}
    {feedback && <div className="feedback" role="status">{feedback}</div>}
    {proposals.length > 0 && <div className="proposal-list"><div className="proposal-caption">Review proposals before saving</div>{proposals.map((proposal, index) => <article className="proposal-card" key={`${proposal.title}-${index}`}><label className="proposal-select"><input type="checkbox" checked={selected[index] ?? false} onChange={(event) => setSelected((current) => current.map((value, itemIndex) => itemIndex === index ? event.target.checked : value))} /><span>Save</span></label><input aria-label={`Proposed task ${index + 1} title`} value={proposal.title} onChange={(event) => updateProposal(index, { title: event.target.value })} /><textarea aria-label={`Proposed task ${index + 1} notes`} value={proposal.notes ?? ''} placeholder="Notes" rows={2} onChange={(event) => updateProposal(index, { notes: event.target.value || null })} /><div className="form-grid"><select aria-label={`Proposed task ${index + 1} type`} value={proposal.task_type} onChange={(event) => updateProposal(index, { task_type: event.target.value as BrainDumpProposal['task_type'] })}><option value="flexible">Flexible</option><option value="deadline">Deadline</option><option value="scheduled">Scheduled</option></select><input aria-label={`Proposed task ${index + 1} duration`} type="number" min="1" value={proposal.estimated_minutes ?? ''} placeholder="Minutes" onChange={(event) => updateProposal(index, { estimated_minutes: event.target.value ? Number(event.target.value) : null })} /><input aria-label={`Proposed task ${index + 1} due`} type="datetime-local" value={fromApiDateTime(proposal.due_at)} onChange={(event) => updateProposal(index, { due_at: toApiDateTime(event.target.value) })} /><input aria-label={`Proposed task ${index + 1} scheduled`} type="datetime-local" value={fromApiDateTime(proposal.scheduled_at)} onChange={(event) => updateProposal(index, { scheduled_at: toApiDateTime(event.target.value) })} /></div>{proposal.dependency_titles.length > 0 && <small className="proposal-uncertainty">Possible prerequisites to review: {proposal.dependency_titles.join(', ')}</small>}{proposal.uncertainty.length > 0 && <small className="proposal-uncertainty">Needs review: {proposal.uncertainty.join(', ')}</small>}<button type="button" className="text-button" onClick={() => { setProposals((current) => current.filter((_item, itemIndex) => itemIndex !== index)); setSelected((current) => current.filter((_item, itemIndex) => itemIndex !== index)); }}>Remove proposal</button></article>)}</div>}
    {proposals.length > 0 && <button type="button" className="action-button primary" onClick={() => void approve()} disabled={isApproving || isMutating}><Check size={13} />Approve selected</button>}
  </section>;
};
