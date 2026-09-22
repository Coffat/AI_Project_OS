import React, { useState } from 'react';
import { UIHandoffPanelState, ResumeTaskInput, SaveHandoffInput } from '../api/client.js';
import { Modal } from './Modal.js';

interface HandoffPanelProps {
  handoffPanel: UIHandoffPanelState | null;
  taskId?: string;
  onResumeTask: (data: ResumeTaskInput) => Promise<void>;
  onSaveHandoff: (data: SaveHandoffInput) => Promise<void>;
}

export const HandoffPanel: React.FC<HandoffPanelProps> = ({
  handoffPanel,
  taskId,
  onResumeTask,
  onSaveHandoff,
}) => {
  const [isResumeModalOpen, setIsResumeModalOpen] = useState(false);
  const [isHandoffModalOpen, setIsHandoffModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Resume form state
  const [resumeProvider, setResumeProvider] = useState('antigravity');
  const [resumeAgent, setResumeAgent] = useState('Antigravity');
  const [resumeAccountLabel, setResumeAccountLabel] = useState('pro-tier');

  // Handoff form state
  const [completedWork, setCompletedWork] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [blockers, setBlockers] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  const currentHandoff = handoffPanel?.currentHandoff;
  const lastSession = handoffPanel?.lastSession;
  const previousSessions = handoffPanel?.previousSessions ?? [];

  const handleResumeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId) return;
    setIsSubmitting(true);
    try {
      await onResumeTask({
        taskId,
        provider: resumeProvider,
        agent: resumeAgent,
        accountLabel: resumeAccountLabel,
      });
      setIsResumeModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleHandoffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskId || !completedWork.trim()) return;
    setIsSubmitting(true);
    try {
      await onSaveHandoff({
        taskId,
        completedWork: completedWork.trim(),
        nextAction: nextAction.trim() || 'Continue planned tasks',
        blockers: blockers.trim() || undefined,
        decisions: decisionNote.trim() ? [decisionNote.trim()] : undefined,
      });
      setIsHandoffModalOpen(false);
      setCompletedWork('');
      setNextAction('');
      setBlockers('');
      setDecisionNote('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Panel Header & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-400" />
          <h2 className="font-bold text-sm tracking-wide text-slate-100 uppercase">Handoff & Sessions</h2>
        </div>

        {/* Primary Actions: Resume & Save Handoff */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsResumeModalOpen(true)}
            disabled={!taskId}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Resume Task
          </button>

          <button
            onClick={() => setIsHandoffModalOpen(true)}
            disabled={!taskId}
            className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            Save Handoff
          </button>
        </div>
      </div>

      {/* Current Handoff Card */}
      {currentHandoff ? (
        <div className="bg-slate-950/80 border border-purple-900/40 rounded-xl p-4 flex flex-col gap-3 text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-semibold text-purple-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              Current Handoff State
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              {new Date(currentHandoff.createdAt).toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <span className="text-[10px] uppercase font-mono text-slate-500 block mb-0.5">Completed Work</span>
              <p className="text-slate-200 bg-slate-900/60 p-2.5 rounded border border-slate-800/60 leading-relaxed">
                {currentHandoff.completedWork}
              </p>
            </div>
            <div>
              <span className="text-[10px] uppercase font-mono text-slate-500 block mb-0.5">Next Recommended Action</span>
              <p className="text-cyan-300 bg-slate-900/60 p-2.5 rounded border border-slate-800/60 font-medium leading-relaxed">
                {currentHandoff.nextAction}
              </p>
            </div>
          </div>

          {currentHandoff.blockers && (
            <div className="bg-rose-950/30 p-2.5 rounded border border-rose-900/40 text-rose-300 text-[11px]">
              <span className="font-bold text-rose-400 block mb-0.5">Active Blocker:</span>
              {currentHandoff.blockers}
            </div>
          )}

          <div className="flex flex-wrap gap-4 text-[11px] text-slate-400 font-mono pt-1">
            <span>Agent: <strong className="text-slate-200">{currentHandoff.agentIdentity}</strong></span>
            {currentHandoff.gitState && (
              <>
                <span>Branch: <strong className="text-slate-200">{currentHandoff.gitState.branch ?? 'N/A'}</strong></span>
                <span>Commit: <strong className="text-slate-200">{currentHandoff.gitState.commitHash?.slice(0, 7) ?? 'N/A'}</strong></span>
                <span>Dirty: <strong className={currentHandoff.gitState.isDirty ? 'text-amber-400' : 'text-emerald-400'}>{String(currentHandoff.gitState.isDirty)}</strong></span>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-500 italic">
          No handoff record saved for this task yet. Save a handoff to enable cross-session continuity.
        </div>
      )}

      {/* Last Session */}
      {lastSession && (
        <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <div>
              <span className="text-[10px] uppercase font-mono text-slate-500 block">Last Active Session</span>
              <span className="font-semibold text-slate-200">
                {lastSession.agent} ({lastSession.provider})
              </span>
              <span className="text-slate-500 font-mono text-[11px] ml-2">
                [{lastSession.accountLabel ?? 'standard'}]
              </span>
            </div>
          </div>
          <div className="text-right font-mono text-[11px] text-slate-400">
            <div>Status: <span className="text-cyan-300 capitalize">{lastSession.status}</span></div>
            <div>{new Date(lastSession.startedAt).toLocaleTimeString()}</div>
          </div>
        </div>
      )}

      {/* Sessions Timeline */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-300 uppercase tracking-wider">Previous Sessions History</span>
          <span className="text-slate-500 font-mono text-[11px]">{previousSessions.length} sessions</span>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {previousSessions.map((s) => (
            <div
              key={s.id}
              className={`p-3 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-3 ${
                s.status === 'active'
                  ? 'bg-cyan-950/20 border-cyan-800/60'
                  : 'bg-slate-950/80 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    s.status === 'active' ? 'bg-cyan-400 animate-pulse' : s.status === 'handoff' ? 'bg-purple-400' : 'bg-slate-500'
                  }`}
                />
                <div>
                  <div className="font-semibold text-slate-200">
                    {s.agent} <span className="font-normal font-mono text-slate-400 text-[11px]">({s.provider})</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    ID: {s.id.slice(0, 8)}... | {s.accountLabel ?? 'standard'}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-right">
                <div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded capitalize ${
                      s.status === 'active'
                        ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                        : s.status === 'handoff'
                        ? 'bg-purple-950 text-purple-400 border border-purple-800'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {s.status}
                  </span>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {new Date(s.startedAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal: Resume Task */}
      <Modal isOpen={isResumeModalOpen} onClose={() => setIsResumeModalOpen(false)} title="Resume Task with Agent">
        <form onSubmit={handleResumeSubmit} className="flex flex-col gap-4 text-xs">
          <p className="text-slate-400">
            Resuming transitions task state <code className="text-cyan-300">handoff &rarr; in_progress</code>, loads
            the predecessor's handoff package, checks Git continuity, and begins a fresh execution session.
          </p>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Select AI Provider</label>
            <select
              value={resumeProvider}
              onChange={(e) => {
                setResumeProvider(e.target.value);
                if (e.target.value === 'claude') setResumeAgent('ClaudeCode');
                else if (e.target.value === 'gemini') setResumeAgent('GeminiCLI');
                else if (e.target.value === 'openai') setResumeAgent('OpenAICodex');
                else setResumeAgent('Antigravity');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            >
              <option value="antigravity">Antigravity (Default Pair Programmer)</option>
              <option value="claude">Claude / Claude Code</option>
              <option value="gemini">Google Gemini CLI</option>
              <option value="openai">OpenAI ChatGPT / Codex</option>
              <option value="local">Local LLM (Ollama / Llama.cpp)</option>
            </select>
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Agent Identifier</label>
            <input
              type="text"
              value={resumeAgent}
              onChange={(e) => setResumeAgent(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
              required
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Account / Tier Label</label>
            <input
              type="text"
              value={resumeAccountLabel}
              onChange={(e) => setResumeAccountLabel(e.target.value)}
              placeholder="e.g. pro-tier, primary-key"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsResumeModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-50"
            >
              {isSubmitting ? 'Resuming...' : 'Confirm Resume'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Save Handoff */}
      <Modal isOpen={isHandoffModalOpen} onClose={() => setIsHandoffModalOpen(false)} title="Save Task Handoff">
        <form onSubmit={handleHandoffSubmit} className="flex flex-col gap-4 text-xs">
          <p className="text-slate-400">
            Captures current working tree state, test status, completed steps, and writes canonical
            <code className="text-purple-300">.ai/handoff/CURRENT.json</code> for seamless transition to subsequent agents.
          </p>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Completed Work *</label>
            <textarea
              rows={3}
              value={completedWork}
              onChange={(e) => setCompletedWork(e.target.value)}
              placeholder="Summarize the code changes, implementations, or fixes finished in this session..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 placeholder-slate-600"
              required
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Recommended Next Action *</label>
            <input
              type="text"
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              placeholder="Next concrete action for the successor agent..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 placeholder-slate-600"
              required
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Blockers (Optional)</label>
            <input
              type="text"
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Any issues blocking task completion..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 placeholder-slate-600"
            />
          </div>

          <div>
            <label className="text-slate-300 font-semibold block mb-1">Architectural Decision (Optional)</label>
            <input
              type="text"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder="Key design decision or trade-off made..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 placeholder-slate-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setIsHandoffModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !completedWork.trim()}
              className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold disabled:opacity-50"
            >
              {isSubmitting ? 'Saving Handoff...' : 'Save Handoff Snapshot'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
