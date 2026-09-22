import React, { useState, useEffect, useRef } from 'react';
import { UIHeaderState, UIProviderAccount, UIProjectInfo } from '../types.js';
import { apiClient } from '../api/client.js';
import { AddProjectModal } from './AddProjectModal.js';

interface HeaderProps {
  header: UIHeaderState | null;
  onRefresh: () => void;
  isLoading: boolean;
  onOpenCockpit?: () => void;
  onSelectProject?: (projectId: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  header,
  onRefresh,
  isLoading,
  onOpenCockpit,
  onSelectProject,
}) => {
  // Provider dropdown state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [accounts, setAccounts] = useState<UIProviderAccount[]>([]);
  const [isSwitching, setIsSwitching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Project selector state
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const [projects, setProjects] = useState<UIProjectInfo[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [isSwitchingProject, setIsSwitchingProject] = useState(false);
  const [isAddProjectModalOpen, setIsAddProjectModalOpen] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsDropdownOpen(false);
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(target)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAccounts = async () => {
    try {
      const state = await apiClient.getProviderCockpit();
      setAccounts(state.accounts);
    } catch {
      // Ignore
    }
  };

  const handleToggleDropdown = () => {
    if (!isDropdownOpen) {
      loadAccounts();
    }
    setIsDropdownOpen(!isDropdownOpen);
  };

  const handleQuickSwitch = async (acc: UIProviderAccount) => {
    if (acc.isActive) return;
    setIsSwitching(true);
    try {
      await apiClient.switchProviderAccount({ accountId: acc.id, forceClose: true });
      setIsDropdownOpen(false);
      onRefresh();
    } catch {
      // Ignore
    } finally {
      setIsSwitching(false);
    }
  };

  const loadProjects = async () => {
    try {
      const res = await apiClient.getProjects();
      setProjects(res.projects);
    } catch {
      // Ignore
    }
  };

  const handleToggleProjectDropdown = () => {
    if (!isProjectDropdownOpen) {
      loadProjects();
      setProjectSearch('');
    }
    setIsProjectDropdownOpen(!isProjectDropdownOpen);
  };

  const handleSwitchProject = async (projectId: string) => {
    if (header?.project.id === projectId) {
      setIsProjectDropdownOpen(false);
      return;
    }
    setIsSwitchingProject(true);
    try {
      await apiClient.switchProject(projectId);
      setIsProjectDropdownOpen(false);
      onSelectProject?.(projectId);
    } catch {
      // Ignore
    } finally {
      setIsSwitchingProject(false);
    }
  };

  const handleProjectAdded = (newProject: UIProjectInfo) => {
    loadProjects();
    onSelectProject?.(newProject.id);
  };

  const filteredProjects = projects.filter((p) => {
    if (!projectSearch.trim()) return true;
    const q = projectSearch.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.rootPath.toLowerCase().includes(q);
  });

  return (
    <>
      <header className="bg-slate-900/90 border-b border-slate-800 backdrop-blur-md px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-40">
        {/* Brand & Project Selector */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-linear-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black tracking-wider text-sm bg-linear-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                  AI PROJECT OS
                </span>
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/50">
                  CONTROL CENTER
                </span>
              </div>
            </div>
          </div>

          <div className="h-6 w-px bg-slate-800 hidden sm:block" />

          {/* Project Selector Dropdown Button */}
          <div className="relative" ref={projectDropdownRef}>
            <button
              onClick={handleToggleProjectDropdown}
              className="flex items-center gap-2.5 bg-slate-950/80 hover:bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/50 transition cursor-pointer group shadow-sm text-left max-w-xs md:max-w-sm"
              title={`Active Project: ${header?.project.rootPath ?? ''} (Click to select or switch)`}
            >
              <div className="w-6 h-6 rounded-md bg-cyan-950/90 border border-cyan-800/50 flex items-center justify-center text-cyan-400 shrink-0 group-hover:border-cyan-400 transition">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>

              <div className="flex flex-col truncate">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs text-slate-200 truncate group-hover:text-cyan-300 transition">
                    {header?.project.name ?? 'Select Project...'}
                  </span>
                  <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-cyan-950 font-mono text-cyan-400 border border-cyan-800/60 shrink-0">
                    WORKSPACE
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 font-mono truncate" title={header?.project.rootPath}>
                  {header?.project.rootPath ?? 'No workspace path'}
                </span>
              </div>

              <svg
                className={`w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-300 transition-transform duration-200 shrink-0 ml-1 ${
                  isProjectDropdownOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Project Dropdown Menu */}
            {isProjectDropdownOpen && (
              <div className="absolute left-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Switch Workspace
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
                  </span>
                </div>

                {/* Project Search Bar */}
                <div className="p-2 border-b border-slate-800/80">
                  <div className="relative">
                    <input
                      type="text"
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Search projects..."
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                    />
                    <svg
                      className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>

                {/* Project Items List */}
                <div className="max-h-60 overflow-y-auto py-1">
                  {filteredProjects.length === 0 ? (
                    <div className="px-4 py-3 text-center text-slate-400 text-xs">
                      {projects.length === 0 ? 'No projects registered yet.' : 'No matching projects found.'}
                    </div>
                  ) : (
                    filteredProjects.map((p) => {
                      const isActive = p.id === header?.project.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleSwitchProject(p.id)}
                          disabled={isSwitchingProject}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                            isActive ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : ''
                          }`}
                        >
                          <div className="flex flex-col truncate pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-semibold text-xs truncate ${isActive ? 'text-cyan-300' : 'text-slate-200'}`}>
                                {p.name}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono truncate" title={p.rootPath}>
                              {p.rootPath}
                            </span>
                          </div>
                          {isActive ? (
                            <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800 shrink-0">
                              ACTIVE
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 hover:text-cyan-300 shrink-0">
                              Select &rarr;
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Bottom action button */}
                <div className="border-t border-slate-800 p-2">
                  <button
                    onClick={() => {
                      setIsProjectDropdownOpen(false);
                      setIsAddProjectModalOpen(true);
                    }}
                    className="w-full py-1.5 px-3 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Open / Add Project...
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Metadata Badges & Switcher */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Git Status */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <span className="text-slate-400 font-mono">git:</span>
            <span className="font-semibold text-slate-200">{header?.git.branch ?? 'main'}</span>
            {header?.git.isDirty ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.2 rounded font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                dirty ({header.git.modifiedCount}m / {header.git.untrackedCount}u)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.2 rounded font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                clean
              </span>
            )}
          </div>

          {/* Current Task */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800">
            <span className="text-slate-400">Task:</span>
            {header?.currentTask ? (
              <span className="font-semibold text-cyan-300 truncate max-w-40" title={header.currentTask.title}>
                {header.currentTask.title}
              </span>
            ) : (
              <span className="text-slate-500 italic">None active</span>
            )}
          </div>

          {/* Provider / Account Quick Switcher Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={handleToggleDropdown}
              className="flex items-center gap-2 bg-slate-950/90 hover:bg-slate-800/90 px-3 py-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/50 transition cursor-pointer group shadow-sm"
              title="Click to switch Provider Account"
            >
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <div className="flex items-center gap-1 text-left">
                <span className="text-slate-400 text-[11px]">Provider:</span>
                <span className="font-semibold text-cyan-300">
                  {header?.currentAgent?.provider ?? 'Antigravity'}
                </span>
                <span className="text-slate-500 font-mono text-[10px] bg-slate-900 px-1.5 py-0.2 rounded border border-slate-800">
                  {header?.currentSession?.accountLabel ?? 'dev-tier'}
                </span>
              </div>
              <svg
                className={`w-3.5 h-3.5 text-slate-400 group-hover:text-cyan-300 transition-transform duration-200 ${
                  isDropdownOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Quick Switcher Menu */}
            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-72 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-3 py-1.5 border-b border-slate-800 flex items-center justify-between">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-slate-400">
                    Switch Account Profile
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono">Anti-Ban Safe</span>
                </div>

                <div className="max-h-56 overflow-y-auto py-1">
                  {accounts.length === 0 ? (
                    <div className="px-4 py-3 text-center text-slate-400 text-xs">
                      No saved profiles yet.
                      <button
                        onClick={() => {
                          setIsDropdownOpen(false);
                          onOpenCockpit?.();
                        }}
                        className="text-cyan-400 block mx-auto mt-1 hover:underline cursor-pointer"
                      >
                        Open Cockpit to Add
                      </button>
                    </div>
                  ) : (
                    accounts.map((acc) => (
                      <button
                        key={acc.id}
                        onClick={() => handleQuickSwitch(acc)}
                        disabled={isSwitching}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/80 transition cursor-pointer ${
                          acc.isActive ? 'bg-cyan-950/40 border-l-2 border-cyan-400' : ''
                        }`}
                      >
                        <div className="flex flex-col truncate">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-200 text-xs">{acc.name}</span>
                            <span className="text-[9px] uppercase px-1 py-0.2 rounded bg-slate-950 font-mono text-slate-400 border border-slate-800">
                              {acc.provider}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            UUID: {acc.fingerprint.machineId.slice(0, 6)}...
                          </span>
                        </div>
                        {acc.isActive ? (
                          <span className="text-[10px] font-bold text-cyan-400 bg-cyan-950 px-1.5 py-0.5 rounded border border-cyan-800">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 hover:text-cyan-300">
                            Switch &rarr;
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>

                <div className="border-t border-slate-800 p-2">
                  <button
                    onClick={() => {
                      setIsDropdownOpen(false);
                      onOpenCockpit?.();
                    }}
                    className="w-full py-1.5 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 font-semibold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Manage in Provider Cockpit &rarr;
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Cockpit shortcut button */}
          <button
            onClick={onOpenCockpit}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 transition flex items-center gap-1.5 font-semibold cursor-pointer"
            title="Open Provider & Account Cockpit"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            Cockpit
          </button>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition disabled:opacity-50 cursor-pointer"
            title="Refresh Control Center State"
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>

      {/* Add Project Modal */}
      <AddProjectModal
        isOpen={isAddProjectModalOpen}
        onClose={() => setIsAddProjectModalOpen(false)}
        onProjectAdded={handleProjectAdded}
      />
    </>
  );
};
