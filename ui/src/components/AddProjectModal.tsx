import React, { useState } from 'react';
import { Modal } from './Modal.js';
import { apiClient, UIProjectInfo } from '../api/client.js';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectAdded: (project: UIProjectInfo) => void;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onProjectAdded,
}) => {
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rootPath.trim()) {
      setError('Please provide a valid directory path for the project.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await apiClient.createProject({
        rootPath: rootPath.trim(),
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      });

      if (res.success && res.project) {
        onProjectAdded(res.project);
        setRootPath('');
        setName('');
        setDescription('');
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoFillName = (pathVal: string) => {
    setRootPath(pathVal);
    if (!name) {
      const parts = pathVal.trim().replace(/[/\\]+$/, '').split(/[/\\]/);
      const last = parts[parts.length - 1];
      if (last) {
        setName(last);
      }
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Open / Add Workspace Project">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded-lg text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Project Directory Path <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={rootPath}
            onChange={(e) => handleAutoFillName(e.target.value)}
            placeholder="/Users/username/projects/my-app or ./relative-path"
            required
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Enter the local absolute or relative path to the repository/workspace directory.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Project Name <span className="text-slate-500 text-[10px] font-normal">(optional, auto-derived from folder)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My Awesome App"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1">
            Description <span className="text-slate-500 text-[10px] font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the workspace"
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isLoading || !rootPath.trim()}
            className="px-4 py-2 text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg shadow-md shadow-cyan-500/20 transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Opening...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Open Project</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
