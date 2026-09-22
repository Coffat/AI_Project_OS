import React, { useState } from 'react';
import { UITaskPanelState } from '../api/client.js';

interface TaskPanelProps {
  taskPanel: UITaskPanelState | null;
  onSelectTask: (taskId: string) => void;
  onAddStep: (title: string) => Promise<void>;
  onCompleteStep: (stepId: string) => Promise<void>;
}

export const TaskPanel: React.FC<TaskPanelProps> = ({
  taskPanel,
  onSelectTask,
  onAddStep,
  onCompleteStep,
}) => {
  const [newStepTitle, setNewStepTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStepTitle.trim()) return;
    setIsSubmitting(true);
    try {
      await onAddStep(newStepTitle.trim());
      setNewStepTitle('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const task = taskPanel?.task;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header & Task Selector */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Task Panel</h2>
        </div>
        {taskPanel?.allTasks && taskPanel.allTasks.length > 0 && (
          <select
            value={task?.id ?? ''}
            onChange={(e) => onSelectTask(e.target.value)}
            aria-label="Select Active Task"
            className="bg-slate-950 border border-slate-800 text-xs rounded-lg px-2.5 py-1 text-slate-200 focus:outline-hidden focus:border-cyan-500"
          >
            {taskPanel.allTasks.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.status}] {t.title}
              </option>
            ))}
          </select>
        )}
      </div>

      {task ? (
        <>
          {/* Task Info & Status Badges */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-400">ID: {task.id}</span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded capitalize ${
                    task.status === 'done'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : task.status === 'in_progress'
                      ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                      : task.status === 'handoff'
                      ? 'bg-purple-950 text-purple-400 border border-purple-800'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {task.status}
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-950 text-amber-300 border border-amber-900/50 uppercase">
                  {task.priority}
                </span>
              </div>
            </div>
            <h3 className="text-base font-semibold text-slate-100">{task.title}</h3>
            {task.goal && (
              <p className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                <span className="font-semibold text-slate-400 block mb-0.5">Goal:</span>
                {task.goal}
              </p>
            )}
          </div>

          {/* Progress Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400">Task Progress</span>
              <span className="font-mono font-bold text-cyan-400">{taskPanel.progressPercentage}%</span>
            </div>
            <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-linear-to-r from-cyan-500 to-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${taskPanel.progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Current Step & Next Action */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">Current Step</span>
              <span className="font-medium text-slate-200 truncate" title={taskPanel.currentStep}>
                {taskPanel.currentStep ?? 'None'}
              </span>
            </div>
            <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">Next Action</span>
              <span className="font-medium text-slate-200 truncate" title={taskPanel.nextAction}>
                {taskPanel.nextAction}
              </span>
            </div>
          </div>

          {/* Blockers */}
          {taskPanel.blockers && taskPanel.blockers.length > 0 && (
            <div className="bg-rose-950/40 border border-rose-800/60 rounded-lg p-3 text-xs text-rose-300 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-rose-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Active Blockers
              </div>
              <ul className="list-disc list-inside space-y-0.5">
                {taskPanel.blockers.map((b, i) => (
                  <li key={i} className="truncate">
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Step Checklist */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Steps Checklist</span>
              <span className="text-[11px] text-slate-500 font-mono">
                {taskPanel.steps.filter((s) => s.status === 'completed').length}/{taskPanel.steps.length} done
              </span>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {taskPanel.steps.map((step) => (
                <div
                  key={step.id}
                  className={`flex items-center justify-between p-2 rounded-lg text-xs border transition ${
                    step.status === 'completed'
                      ? 'bg-slate-950/40 border-slate-900 text-slate-500 line-through'
                      : step.status === 'in_progress'
                      ? 'bg-cyan-950/20 border-cyan-800/50 text-slate-200 font-medium'
                      : 'bg-slate-950/80 border-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-mono text-[10px] text-slate-500">#{step.stepOrder}</span>
                    <span className="truncate" title={step.title}>{step.title}</span>
                  </div>
                  {step.status !== 'completed' && (
                    <button
                      onClick={() => onCompleteStep(step.id)}
                      className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-emerald-700 hover:text-white transition font-mono shrink-0 ml-2"
                    >
                      Complete
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add Step input */}
            <form onSubmit={handleAddStep} className="flex gap-2 mt-1">
              <input
                type="text"
                placeholder="Add next action or step..."
                value={newStepTitle}
                onChange={(e) => setNewStepTitle(e.target.value)}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-hidden focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={isSubmitting || !newStepTitle.trim()}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50 transition shrink-0"
              >
                Add Step
              </button>
            </form>
          </div>
        </>
      ) : (
        <div className="py-8 text-center text-xs text-slate-500 italic">
          No tasks found in project. Start a task using the orchestrator or CLI.
        </div>
      )}
    </div>
  );
};
