import React, { useState } from 'react';
import { UIValidationPanelState, ValidateTaskInput } from '../api/client.js';

interface ValidationPanelProps {
  validationPanel: UIValidationPanelState | null;
  taskId?: string;
  onRunValidation: (data: ValidateTaskInput) => Promise<void>;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  validationPanel,
  taskId,
  onRunValidation,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [testCmd, setTestCmd] = useState('');

  const handleValidate = async () => {
    if (!taskId) return;
    setIsRunning(true);
    try {
      await onRunValidation({
        taskId,
        testCommand: testCmd.trim() || undefined,
      });
    } finally {
      setIsRunning(false);
    }
  };

  const gates = [
    { name: 'Tests', gate: validationPanel?.tests },
    { name: 'Lint', gate: validationPanel?.lint },
    { name: 'Typecheck', gate: validationPanel?.typecheck },
    { name: 'Build', gate: validationPanel?.build },
  ];

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'passed':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold uppercase">
            Passed
          </span>
        );
      case 'failed':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 font-mono font-bold uppercase">
            Failed
          </span>
        );
      case 'pending':
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono font-bold uppercase">
            Pending
          </span>
        );
      default:
        return (
          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono uppercase">
            None
          </span>
        );
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header & Run Trigger */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Validation Gates & Git Diff</h2>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Custom test cmd (optional)"
            value={testCmd}
            onChange={(e) => setTestCmd(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 placeholder-slate-500 text-xs w-44 focus:outline-hidden focus:border-cyan-500"
          />
          <button
            onClick={handleValidate}
            disabled={!taskId || isRunning}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg
              className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {isRunning ? 'Validating...' : 'Run Validation'}
          </button>
        </div>
      </div>

      {/* 4 Gates Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {gates.map((g) => (
          <div key={g.name} className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300">{g.name}</span>
              {getStatusBadge(g.gate?.status)}
            </div>
            {g.gate?.durationMs !== undefined && (
              <span className="text-[10px] text-slate-500 font-mono">
                Duration: {g.gate.durationMs}ms
              </span>
            )}
            {g.gate?.lastRunAt && (
              <span className="text-[10px] text-slate-500 font-mono">
                {new Date(g.gate.lastRunAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Output Console / Log Viewer */}
      {validationPanel?.tests.stdout && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Test Execution Logs</span>
          <pre className="bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-36">
            {validationPanel.tests.stdout}
          </pre>
        </div>
      )}

      {/* Git Diff Viewer */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-300 uppercase tracking-wider">Working Tree Git Diff</span>
          <span className="text-slate-500 font-mono text-[11px]">
            {validationPanel?.gitDiff.modified.length ?? 0} modified, {validationPanel?.gitDiff.added.length ?? 0} added
          </span>
        </div>

        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap gap-2">
            {validationPanel?.gitDiff.modified.map((f, i) => (
              <span key={i} className="font-mono text-[11px] text-amber-300 bg-amber-950/40 border border-amber-900/60 px-2 py-0.5 rounded">
                M {f}
              </span>
            ))}
            {validationPanel?.gitDiff.added.map((f, i) => (
              <span key={i} className="font-mono text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-900/60 px-2 py-0.5 rounded">
                A {f}
              </span>
            ))}
            {validationPanel?.gitDiff.deleted.map((f, i) => (
              <span key={i} className="font-mono text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/60 px-2 py-0.5 rounded">
                D {f}
              </span>
            ))}
            {(!validationPanel?.gitDiff.modified.length && !validationPanel?.gitDiff.added.length && !validationPanel?.gitDiff.deleted.length) && (
              <span className="text-slate-500 italic text-[11px]">Working tree is clean. No uncommitted modifications.</span>
            )}
          </div>

          {validationPanel?.gitDiff.summary && validationPanel.gitDiff.summary !== 'Clean working tree' && (
            <pre className="mt-1 font-mono text-[10px] text-slate-400 bg-slate-900/80 p-2.5 rounded border border-slate-800/80 overflow-x-auto max-h-32">
              {validationPanel.gitDiff.summary}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
