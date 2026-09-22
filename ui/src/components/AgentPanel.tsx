import React from 'react';
import { UIAgentPanelState } from '../api/client.js';

interface AgentPanelProps {
  agentPanel: UIAgentPanelState | null;
  onOpenCockpit?: () => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ agentPanel, onOpenCockpit }) => {
  const sessions = agentPanel?.sessions ?? [];

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Agent Adapter & Identity</h2>
        </div>
        {onOpenCockpit && (
          <button
            onClick={onOpenCockpit}
            className="text-[11px] font-semibold px-2 py-1 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 transition flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Manage Accounts &rarr;
          </button>
        )}
      </div>

      {/* Active Agent Identity Card */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-linear-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-md shadow-cyan-500/10">
              {agentPanel?.agent?.charAt(0) ?? 'A'}
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">{agentPanel?.agent ?? 'No Agent Active'}</h3>
              <span className="text-[11px] text-cyan-400 font-mono">
                Provider: {agentPanel?.currentProvider ?? 'N/A'}
              </span>
            </div>
          </div>
          <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
            {agentPanel?.accountLabel ?? 'standard'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Current Session ID</span>
            <span className="font-mono text-[11px] text-slate-300 truncate block" title={agentPanel?.session}>
              {agentPanel?.session ?? 'None'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Identity Model</span>
            <span className="text-slate-300">Decoupled Metadata Only</span>
          </div>
        </div>
      </div>

      {/* Sessions History Table */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-300 uppercase tracking-wider">Registered Sessions</span>
          <span className="text-slate-500 font-mono text-[11px]">{sessions.length} sessions</span>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-xs flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 truncate">
                <span className="font-bold text-slate-200">{s.agent}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 font-mono border border-slate-800">
                  {s.provider}
                </span>
                <span className="text-[11px] text-slate-500 font-mono truncate" title={s.id}>
                  {s.id.slice(0, 8)}...
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(s.startedAt).toLocaleTimeString()}
                </span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded capitalize ${
                    s.status === 'active'
                      ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                      : s.status === 'handoff'
                      ? 'bg-purple-950 text-purple-400 border border-purple-800'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {s.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
