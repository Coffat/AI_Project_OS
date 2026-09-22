import React, { useState } from 'react';
import { UIMemoryPanelState } from '../api/client.js';

interface MemoryPanelProps {
  memoryPanel: UIMemoryPanelState | null;
}

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ memoryPanel }) => {
  const [activeTab, setActiveTab] = useState<'project' | 'architecture' | 'decisions' | 'constraints' | 'research'>('project');

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Memory & Knowledge</h2>
        </div>
        <span className="text-[11px] font-mono text-slate-400">Canonical Project Memory</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 pb-1 text-xs">
        {(['project', 'architecture', 'decisions', 'constraints', 'research'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 rounded-t-lg font-medium transition capitalize ${
              activeTab === tab
                ? 'bg-slate-800 text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            {tab}
            {tab === 'decisions' && ` (${memoryPanel?.decisions.length ?? 0})`}
            {tab === 'constraints' && ` (${memoryPanel?.constraints.length ?? 0})`}
            {tab === 'research' && ` (${memoryPanel?.research.length ?? 0})`}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-56 max-h-80 overflow-y-auto text-xs pr-1">
        {activeTab === 'project' && (
          <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800 font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
            {memoryPanel?.projectKnowledge || 'No project knowledge compiled yet.'}
          </div>
        )}

        {activeTab === 'architecture' && (
          <div className="bg-slate-950/80 p-4 rounded-lg border border-slate-800 font-mono text-slate-300 whitespace-pre-wrap leading-relaxed">
            {memoryPanel?.architecture || 'No architecture specification compiled yet.'}
          </div>
        )}

        {activeTab === 'decisions' && (
          <div className="space-y-2">
            {memoryPanel && memoryPanel.decisions.length > 0 ? (
              memoryPanel.decisions.map((d) => (
                <div key={d.id} className="bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-100">{d.title}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 uppercase font-mono">
                      {d.status}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs">{d.context}</p>
                  <div className="bg-slate-900/60 p-2 rounded text-[11px] text-slate-400 border border-slate-800/60">
                    <span className="font-semibold text-slate-300 block">Rationale:</span>
                    {d.decisionRationale}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-slate-500 italic">No Architecture Decision Records (ADRs) recorded.</div>
            )}
          </div>
        )}

        {activeTab === 'constraints' && (
          <div className="space-y-2">
            {memoryPanel && memoryPanel.constraints.length > 0 ? (
              memoryPanel.constraints.map((c) => (
                <div key={c.id} className="bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-100">{c.title}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 uppercase font-mono">
                      {c.enforcementLevel}
                    </span>
                  </div>
                  <p className="text-slate-300 text-xs">{c.ruleContent}</p>
                  <div className="flex gap-4 text-[10px] text-slate-500 font-mono">
                    <span>Category: {c.category}</span>
                    {c.sourceFile && <span>Source: {c.sourceFile}</span>}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-slate-500 italic">No architectural constraints recorded.</div>
            )}
          </div>
        )}

        {activeTab === 'research' && (
          <div className="space-y-2">
            {memoryPanel && memoryPanel.research.length > 0 ? (
              memoryPanel.research.map((r) => (
                <div key={r.id} className="bg-slate-950/80 p-3.5 rounded-lg border border-slate-800 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm text-slate-100">{r.title}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 uppercase font-mono">
                      {r.status}
                    </span>
                  </div>
                  {r.question && <p className="text-xs text-slate-300 italic">"{r.question}"</p>}
                  <span className="text-[10px] text-slate-500 font-mono">
                    Created: {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            ) : (
              <div className="py-6 text-center text-slate-500 italic">No external research proposals recorded.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
