import React, { useState, useEffect, useCallback } from 'react';
import {
  apiClient,
  FullDashboardState,
  ResumeTaskInput,
  SaveHandoffInput,
  ValidateTaskInput,
} from './api/client.js';
import { Header } from './components/Header.js';
import { TaskPanel } from './components/TaskPanel.js';
import { ContextPanel } from './components/ContextPanel.js';
import { MemoryPanel } from './components/MemoryPanel.js';
import { GraphPanel } from './components/GraphPanel.js';
import { HandoffPanel } from './components/HandoffPanel.js';
import { ValidationPanel } from './components/ValidationPanel.js';
import { AgentPanel } from './components/AgentPanel.js';
import { ProviderCockpit } from './components/ProviderCockpit.js';

export const App: React.FC = () => {
  const [data, setData] = useState<FullDashboardState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'all' | 'cockpit' | 'task_context' | 'memory_graph' | 'handoff_val'>('all');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const loadData = useCallback(async (taskId?: string, projectId?: string) => {
    try {
      setIsLoading(true);
      const dashboard = await apiClient.getDashboard(taskId, projectId);
      setData(dashboard);
      if (dashboard.header?.project.id) {
        setSelectedProjectId(dashboard.header.project.id);
      }
      if (!taskId && dashboard.taskPanel.task?.id) {
        setSelectedTaskId(dashboard.taskPanel.task.id);
      }
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(selectedTaskId, selectedProjectId);

    // Auto-refresh every 6 seconds
    const interval = setInterval(() => {
      apiClient.getDashboard(selectedTaskId, selectedProjectId).then((dash) => {
        setData(dash);
      }).catch(() => {});
    }, 6000);

    return () => clearInterval(interval);
  }, [loadData, selectedTaskId, selectedProjectId]);

  const handleSelectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    loadData(taskId, selectedProjectId);
  };

  const handleSelectProject = async (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedTaskId(undefined);
    await loadData(undefined, projectId);
    showNotification('Switched workspace project');
  };

  const handleResumeTask = async (input: ResumeTaskInput) => {
    try {
      await apiClient.resumeTask(input);
      showNotification(`Task successfully resumed with ${input.agent ?? 'agent'}`);
      await loadData(input.taskId, selectedProjectId);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleSaveHandoff = async (input: SaveHandoffInput) => {
    try {
      await apiClient.saveHandoff(input);
      showNotification('Handoff snapshot successfully recorded and persisted to disk');
      await loadData(input.taskId, selectedProjectId);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleRunValidation = async (input: ValidateTaskInput) => {
    try {
      await apiClient.runValidation(input);
      showNotification('Validation gates completed');
      await loadData(input.taskId, selectedProjectId);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleAddStep = async (title: string) => {
    if (!selectedTaskId) return;
    try {
      await apiClient.recordProgress({
        taskId: selectedTaskId,
        addStep: { title },
      });
      showNotification(`Added step: "${title}"`);
      await loadData(selectedTaskId, selectedProjectId);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleCompleteStep = async (stepId: string) => {
    if (!selectedTaskId) return;
    try {
      await apiClient.recordProgress({
        taskId: selectedTaskId,
        stepId,
        completeStep: true,
      });
      showNotification('Step marked as completed');
      await loadData(selectedTaskId, selectedProjectId);
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <Header
        header={data?.header ?? null}
        onRefresh={() => loadData(selectedTaskId, selectedProjectId)}
        isLoading={isLoading}
        onOpenCockpit={() => setActiveView('cockpit')}
        onSelectProject={handleSelectProject}
      />

      {/* Navigation Sub-header */}
      <div className="bg-slate-900/50 border-b border-slate-800/80 px-6 py-2 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium mr-2">Layout View:</span>
          {[
            { id: 'all', label: 'Mission Control (All Panels)' },
            { id: 'cockpit', label: 'Provider Cockpit' },
            { id: 'task_context', label: 'Task & Context' },
            { id: 'memory_graph', label: 'Memory & Graph' },
            { id: 'handoff_val', label: 'Handoff & Validation' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveView(tab.id as any)}
              className={`px-3 py-1 rounded-lg font-medium transition ${
                activeView === tab.id
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Action feedback toast */}
        {notification && (
          <div
            className={`text-xs px-3 py-1 rounded-lg border font-medium transition flex items-center gap-1.5 animate-in fade-in ${
              notification.type === 'error'
                ? 'bg-rose-950 text-rose-300 border-rose-800'
                : 'bg-emerald-950 text-emerald-300 border-emerald-800'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${notification.type === 'error' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            {notification.message}
          </div>
        )}
      </div>

      {/* Scrollable Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeView === 'cockpit' && (
          <ProviderCockpit onAccountSwitched={() => loadData(selectedTaskId, selectedProjectId)} />
        )}

        {activeView === 'all' && (
          <>
            {/* Provider Cockpit section at top of Mission Control */}
            <ProviderCockpit onAccountSwitched={() => loadData(selectedTaskId, selectedProjectId)} />

            {/* Row 1: Task Panel & Context Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TaskPanel
                taskPanel={data?.taskPanel ?? null}
                onSelectTask={handleSelectTask}
                onAddStep={handleAddStep}
                onCompleteStep={handleCompleteStep}
              />
              <ContextPanel contextPanel={data?.contextPanel ?? null} />
            </div>

            {/* Row 2: Interactive Graph Panel */}
            <GraphPanel graphPanel={data?.graphPanel ?? null} />

            {/* Row 3: Memory & Handoff */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <MemoryPanel memoryPanel={data?.memoryPanel ?? null} />
              <HandoffPanel
                handoffPanel={data?.handoffPanel ?? null}
                taskId={selectedTaskId}
                onResumeTask={handleResumeTask}
                onSaveHandoff={handleSaveHandoff}
              />
            </div>

            {/* Row 4: Validation & Agent */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ValidationPanel
                validationPanel={data?.validationPanel ?? null}
                taskId={selectedTaskId}
                onRunValidation={handleRunValidation}
              />
              <AgentPanel
                agentPanel={data?.agentPanel ?? null}
                onOpenCockpit={() => setActiveView('cockpit')}
              />
            </div>
          </>
        )}

        {activeView === 'task_context' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TaskPanel
              taskPanel={data?.taskPanel ?? null}
              onSelectTask={handleSelectTask}
              onAddStep={handleAddStep}
              onCompleteStep={handleCompleteStep}
            />
            <ContextPanel contextPanel={data?.contextPanel ?? null} />
          </div>
        )}

        {activeView === 'memory_graph' && (
          <div className="space-y-6">
            <GraphPanel graphPanel={data?.graphPanel ?? null} />
            <MemoryPanel memoryPanel={data?.memoryPanel ?? null} />
          </div>
        )}

        {activeView === 'handoff_val' && (
          <div className="space-y-6">
            <HandoffPanel
              handoffPanel={data?.handoffPanel ?? null}
              taskId={selectedTaskId}
              onResumeTask={handleResumeTask}
              onSaveHandoff={handleSaveHandoff}
            />
            <ValidationPanel
              validationPanel={data?.validationPanel ?? null}
              taskId={selectedTaskId}
              onRunValidation={handleRunValidation}
            />
            <AgentPanel
              agentPanel={data?.agentPanel ?? null}
              onOpenCockpit={() => setActiveView('cockpit')}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
