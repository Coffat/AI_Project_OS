import React from 'react';
import { UIContextPanelState } from '../api/client.js';

interface ContextPanelProps {
  contextPanel: UIContextPanelState | null;
}

export const ContextPanel: React.FC<ContextPanelProps> = ({ contextPanel }) => {
  const budget = contextPanel?.contextBudget ?? 8000;
  const used = contextPanel?.tokensUsed ?? 0;
  const percentage = contextPanel?.utilizationPercentage ?? 0;

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Context Panel</h2>
        </div>
        <span className="text-[11px] font-mono text-slate-400">Zero-LLM Pipeline</span>
      </div>

      {/* Budget Gauge */}
      <div className="bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 font-medium">Context Token Budget</span>
          <span className="font-mono text-slate-200">
            <strong className="text-cyan-400">{used.toLocaleString()}</strong> / {budget.toLocaleString()} tokens
          </span>
        </div>
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              percentage > 90
                ? 'bg-rose-500'
                : percentage > 70
                ? 'bg-amber-500'
                : 'bg-linear-to-r from-blue-500 to-cyan-400'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-[11px] text-slate-500 font-mono">
          <span>Utilization: {percentage}%</span>
          <span>Remaining: {Math.max(0, budget - used).toLocaleString()} tokens</span>
        </div>
      </div>

      {/* Sub-sections grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {/* Relevant Files */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center font-semibold text-slate-300 border-b border-slate-800 pb-1.5">
            <span>Relevant Files</span>
            <span className="font-mono text-[10px] text-slate-500">{contextPanel?.relevantFiles.length ?? 0} files</span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {contextPanel && contextPanel.relevantFiles.length > 0 ? (
              contextPanel.relevantFiles.map((f, i) => (
                <div key={i} className="flex flex-col bg-slate-900/60 p-1.5 rounded border border-slate-800/60">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-mono text-cyan-300 truncate" title={f.path}>{f.path}</span>
                    <span className="text-slate-500 text-[10px] font-mono">{f.tokenCount}t</span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate">{f.reason}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic text-[11px]">No active file dependencies</span>
            )}
          </div>
        </div>

        {/* Relevant Symbols */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center font-semibold text-slate-300 border-b border-slate-800 pb-1.5">
            <span>Relevant Symbols</span>
            <span className="font-mono text-[10px] text-slate-500">{contextPanel?.relevantSymbols.length ?? 0} symbols</span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {contextPanel && contextPanel.relevantSymbols.length > 0 ? (
              contextPanel.relevantSymbols.map((s, i) => (
                <div key={i} className="flex flex-col bg-slate-900/60 p-1.5 rounded border border-slate-800/60 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-blue-300 font-semibold">{s.name}</span>
                    <span className="text-[10px] px-1 rounded bg-slate-800 text-slate-400">{s.kind}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono truncate">{s.filePath}:{s.line}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic text-[11px]">No symbols indexed for context</span>
            )}
          </div>
        </div>

        {/* Relevant Decisions */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center font-semibold text-slate-300 border-b border-slate-800 pb-1.5">
            <span>Relevant Decisions</span>
            <span className="font-mono text-[10px] text-slate-500">{contextPanel?.relevantDecisions.length ?? 0} ADRs</span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {contextPanel && contextPanel.relevantDecisions.length > 0 ? (
              contextPanel.relevantDecisions.map((d) => (
                <div key={d.id} className="flex flex-col bg-slate-900/60 p-1.5 rounded border border-slate-800/60 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 truncate">{d.title}</span>
                    <span className="text-[10px] px-1 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">{d.status}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate mt-0.5">{d.rationale}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic text-[11px]">No active decision records</span>
            )}
          </div>
        </div>

        {/* Relevant Constraints */}
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 flex flex-col gap-2">
          <div className="flex justify-between items-center font-semibold text-slate-300 border-b border-slate-800 pb-1.5">
            <span>Relevant Constraints</span>
            <span className="font-mono text-[10px] text-slate-500">{contextPanel?.relevantConstraints.length ?? 0} rules</span>
          </div>
          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {contextPanel && contextPanel.relevantConstraints.length > 0 ? (
              contextPanel.relevantConstraints.map((c) => (
                <div key={c.id} className="flex flex-col bg-slate-900/60 p-1.5 rounded border border-slate-800/60 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300 truncate">{c.title || c.type}</span>
                    <span className="text-[10px] px-1 rounded bg-amber-950 text-amber-400 border border-amber-800 uppercase font-mono">{c.severity}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 truncate mt-0.5">{c.description}</span>
                </div>
              ))
            ) : (
              <span className="text-slate-500 italic text-[11px]">No architectural constraints</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
