import React, { useState } from 'react';
import { Modal } from './Modal.js';
import { UIProviderAccount } from '../types.js';

interface SafeSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetAccount: UIProviderAccount | null;
  warningMessage: string;
  onConfirmSwitch: (accountId: string, forceClose: boolean, relaunch: boolean) => Promise<void>;
}

export const SafeSwitchModal: React.FC<SafeSwitchModalProps> = ({
  isOpen,
  onClose,
  targetAccount,
  warningMessage,
  onConfirmSwitch,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [relaunch, setRelaunch] = useState(true);

  if (!targetAccount) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirmSwitch(targetAccount.id, true, relaunch);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Safe Account Switch Verification">
      <div className="flex flex-col gap-4 text-xs">
        {/* Warning card */}
        <div className="p-3 bg-amber-950/50 border border-amber-800/60 rounded-lg flex items-start gap-2.5 text-amber-200">
          <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <span className="font-bold text-amber-300 block">Active IDE Process Detected</span>
            <p className="mt-0.5 text-slate-300">
              {warningMessage ||
                `${targetAccount.provider.toUpperCase()} is currently open. To prevent file write collisions and token invalidation, the process should be closed gracefully before swapping state.`}
            </p>
          </div>
        </div>

        {/* Action details */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-2">
          <span className="font-semibold text-slate-300 block">Switch Sequence:</span>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>Gracefully terminate running {targetAccount.provider.toUpperCase()} processes.</li>
            <li>Snapshot current profile state to vault backup.</li>
            <li>Restore target profile: <strong className="text-slate-200">{targetAccount.name}</strong> ({targetAccount.accountLabel}).</li>
            <li>Inject persistent virtual Machine ID to safeguard account against anti-abuse bans.</li>
          </ul>
        </div>

        <label className="flex items-center gap-2 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={relaunch}
            onChange={(e) => setRelaunch(e.target.checked)}
            className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500 bg-slate-900"
          />
          <span className="text-slate-300 font-medium">
            Automatically relaunch {targetAccount.provider.toUpperCase()} after switching
          </span>
        </label>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold transition disabled:opacity-50 shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
          >
            {isSubmitting ? 'Switching Safely...' : 'Close IDE & Switch Safely'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
