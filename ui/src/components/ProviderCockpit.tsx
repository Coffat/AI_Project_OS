import React, { useState, useEffect } from 'react';
import {
  UIProviderType,
  UIProviderAccount,
  UIProviderCockpitState,
  UICaptureAccountInput,
  UIAddAccountManualInput,
} from '../types.js';
import { apiClient } from '../api/client.js';
import { AddAccountModal } from './AddAccountModal.js';
import { SafeSwitchModal } from './SafeSwitchModal.js';

interface ProviderCockpitProps {
  onAccountSwitched?: () => void;
}

export const ProviderCockpit: React.FC<ProviderCockpitProps> = ({ onAccountSwitched }) => {
  const [data, setData] = useState<UIProviderCockpitState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [safeSwitchTarget, setSafeSwitchTarget] = useState<UIProviderAccount | null>(null);
  const [safeSwitchWarning, setSafeSwitchWarning] = useState<string>('');
  const [isSafeSwitchModalOpen, setIsSafeSwitchModalOpen] = useState(false);
  const [cooldownTime, setCooldownTime] = useState<Record<string, number>>({});
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const state = await apiClient.getProviderCockpit();
      setData(state);
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to load cockpit data',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCapture = async (input: UICaptureAccountInput) => {
    const res = await apiClient.captureProviderAccount(input);
    if (res.success) {
      setFeedbackMsg({ text: `Captured active account: ${res.account.name}`, type: 'success' });
      await loadData();
      onAccountSwitched?.();
    }
  };

  const handleManualAdd = async (input: UIAddAccountManualInput) => {
    const res = await apiClient.addProviderAccount(input);
    if (res.success) {
      setFeedbackMsg({ text: `Added account profile: ${res.account.name}`, type: 'success' });
      await loadData();
    }
  };

  const handleSwitch = async (account: UIProviderAccount, forceClose = false, relaunch = false) => {
    try {
      const result = await apiClient.switchProviderAccount({
        accountId: account.id,
        forceClose,
      });

      if (!result.success && !forceClose) {
        setSafeSwitchTarget(account);
        setSafeSwitchWarning(result.message);
        setIsSafeSwitchModalOpen(true);
        return;
      }

      setFeedbackMsg({ text: result.message, type: 'success' });
      await loadData();
      onAccountSwitched?.();

      if (relaunch) {
        await apiClient.launchProviderInstance(account.provider);
      }
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to switch account',
        type: 'error',
      });
    }
  };

  const handleRefreshQuota = async (accountId: string) => {
    try {
      const res = await apiClient.refreshProviderQuota(accountId);
      if (res.success) {
        setFeedbackMsg({ text: 'Quota successfully updated', type: 'success' });
        // Set local 3-minute cooldown UI counter
        setCooldownTime((prev) => ({ ...prev, [accountId]: Date.now() + 180000 }));
        await loadData();
      }
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to refresh quota',
        type: 'error',
      });
    }
  };

  const handleDelete = async (accountId: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete profile "${name}"?`)) return;
    try {
      const res = await apiClient.deleteProviderAccount(accountId);
      if (res.success) {
        setFeedbackMsg({ text: `Deleted profile "${name}"`, type: 'success' });
        await loadData();
      }
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to delete account',
        type: 'error',
      });
    }
  };

  const handleLaunch = async (provider: UIProviderType) => {
    try {
      const res = await apiClient.launchProviderInstance(provider);
      setFeedbackMsg({
        text: res.message,
        type: res.launched ? 'success' : 'error',
      });
    } catch (err) {
      setFeedbackMsg({
        text: err instanceof Error ? err.message : 'Failed to launch IDE',
        type: 'error',
      });
    }
  };

  const accounts = data?.accounts ?? [];
  const filteredAccounts =
    selectedProvider === 'all'
      ? accounts
      : accounts.filter((a) => a.provider === selectedProvider);

  const getProviderTheme = (provider: UIProviderType) => {
    switch (provider) {
      case 'antigravity':
        return {
          bg: 'from-cyan-600 to-blue-600',
          badge: 'bg-cyan-950 text-cyan-300 border-cyan-800',
          ring: 'focus:border-cyan-400',
        };
      case 'cursor':
        return {
          bg: 'from-indigo-600 to-purple-600',
          badge: 'bg-indigo-950 text-indigo-300 border-indigo-800',
          ring: 'focus:border-indigo-400',
        };
      case 'windsurf':
        return {
          bg: 'from-teal-600 to-emerald-600',
          badge: 'bg-teal-950 text-teal-300 border-teal-800',
          ring: 'focus:border-teal-400',
        };
      case 'copilot':
        return {
          bg: 'from-violet-600 to-fuchsia-600',
          badge: 'bg-violet-950 text-violet-300 border-violet-800',
          ring: 'focus:border-violet-400',
        };
      case 'claude':
        return {
          bg: 'from-amber-600 to-orange-600',
          badge: 'bg-amber-950 text-amber-300 border-amber-800',
          ring: 'focus:border-amber-400',
        };
      case 'openai':
        return {
          bg: 'from-emerald-600 to-green-600',
          badge: 'bg-emerald-950 text-emerald-300 border-emerald-800',
          ring: 'focus:border-emerald-400',
        };
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-150">
      {/* Cockpit Top Bar */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-xl backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-linear-to-tr from-cyan-500 via-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-slate-100 uppercase tracking-wide">
                Provider & Account Cockpit
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                Anti-Ban Engine Armed
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Multi-Account Management & Virtual Device Fingerprint Preservation for AI IDEs
            </p>
          </div>
        </div>

        {/* Global Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => loadData()}
            disabled={isLoading}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold transition flex items-center gap-1.5"
          >
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-4 py-1.5 rounded-lg bg-linear-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-lg shadow-cyan-500/10"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Account
          </button>
        </div>
      </div>

      {/* Action feedback toast */}
      {feedbackMsg && (
        <div
          className={`text-xs px-4 py-2.5 rounded-lg border font-medium transition flex items-center justify-between gap-2 shadow-md ${
            feedbackMsg.type === 'error'
              ? 'bg-rose-950/80 text-rose-300 border-rose-800'
              : 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${feedbackMsg.type === 'error' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
            {feedbackMsg.text}
          </div>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-slate-400 hover:text-slate-200 text-sm font-bold"
          >
            &times;
          </button>
        </div>
      )}

      {/* Provider Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { id: 'all', label: `All Platforms (${accounts.length})` },
          { id: 'antigravity', label: 'Google Antigravity' },
          { id: 'cursor', label: 'Cursor' },
          { id: 'windsurf', label: 'Windsurf' },
          { id: 'copilot', label: 'VS Code / Copilot' },
          { id: 'claude', label: 'Claude Code' },
          { id: 'openai', label: 'OpenAI / Codex' },
        ].map((tab) => {
          const count =
            tab.id === 'all'
              ? accounts.length
              : accounts.filter((a) => a.provider === tab.id).length;
          return (
            <button
              key={tab.id}
              onClick={() => setSelectedProvider(tab.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 ${
                selectedProvider === tab.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                  : 'bg-slate-900/60 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {tab.id !== 'all' && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950/60 text-slate-400 font-mono">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Account Cards Grid */}
      {filteredAccounts.length === 0 ? (
        <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-200">No Account Profiles Found</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            You don't have any account profiles registered for this provider. You can capture the active login from your IDE or import one manually.
          </p>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
          >
            + Add Account Profile
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredAccounts.map((acc) => {
            const theme = getProviderTheme(acc.provider);
            const totalCredits = acc.quota?.totalCredits ?? 500;
            const usedCredits = acc.quota?.usedCredits ?? 0;
            const percentUsed = Math.min(100, Math.round((usedCredits / totalCredits) * 100));

            return (
              <div
                key={acc.id}
                className={`bg-slate-900/80 border rounded-xl p-5 flex flex-col justify-between gap-4 transition shadow-lg hover:border-slate-700 ${
                  acc.isActive
                    ? 'border-cyan-500/60 shadow-cyan-500/10 ring-1 ring-cyan-500/30'
                    : 'border-slate-800'
                }`}
              >
                {/* Card Top: Provider Icon, Account Name, Active Badge */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg bg-linear-to-tr ${theme.bg} flex items-center justify-center font-bold text-white text-base shadow-md`}>
                      {acc.provider.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-slate-100 truncate max-w-36" title={acc.name}>
                          {acc.name}
                        </h3>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono uppercase border ${theme.badge}`}>
                          {acc.accountLabel}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 truncate block max-w-44 font-mono">
                        {acc.email ?? acc.provider.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Active Indicator */}
                  {acc.isActive ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/80 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                      ACTIVE
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDelete(acc.id, acc.name)}
                      className="text-slate-500 hover:text-rose-400 transition p-1"
                      title="Delete profile"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Quota & Usage Bar */}
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400 font-medium">Remaining Credits</span>
                    <span className="font-bold text-slate-200">
                      {totalCredits - usedCredits}{' '}
                      <span className="text-[10px] font-normal text-slate-500">/ {totalCredits}</span>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        percentUsed > 80
                          ? 'bg-rose-500'
                          : percentUsed > 50
                          ? 'bg-amber-500'
                          : 'bg-linear-to-r from-cyan-400 to-indigo-500'
                      }`}
                      style={{ width: `${percentUsed}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>Plan: <strong className="text-slate-200 font-semibold">{acc.quota?.planType ?? 'Pro'}</strong></span>
                    {(() => {
                      const isCooldown = (cooldownTime[acc.id] ?? 0) > Date.now();
                      return (
                        <button
                          onClick={() => handleRefreshQuota(acc.id)}
                          disabled={isCooldown}
                          className="text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 underline text-[10px] flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {isCooldown ? 'Cooldown (3m)' : 'Refresh Quota'}
                        </button>
                      );
                    })()}
                  </div>
                </div>

                {/* Fingerprint Safety Info */}
                <div className="flex items-center justify-between text-[10px] font-mono px-2 py-1 rounded bg-slate-950/40 text-slate-500 border border-slate-800/60">
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    Device UUID:
                  </span>
                  <span className="text-slate-400" title={acc.fingerprint.machineId}>
                    {acc.fingerprint.machineId.slice(0, 8)}...{acc.fingerprint.machineId.slice(-6)}
                  </span>
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                  {acc.isActive ? (
                    <button
                      disabled
                      className="flex-1 py-1.5 rounded-lg bg-cyan-950/40 text-cyan-300 border border-cyan-800/60 text-xs font-semibold cursor-default text-center"
                    >
                      Currently Active
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSwitch(acc, false)}
                      className="flex-1 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition text-center shadow-sm shadow-indigo-600/20"
                    >
                      Switch Account
                    </button>
                  )}

                  <button
                    onClick={() => handleLaunch(acc.provider)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition flex items-center gap-1 shrink-0"
                    title={`Launch ${acc.provider.toUpperCase()}`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Launch
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modals */}
      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={async () => {
          setFeedbackMsg({ text: 'Liên kết tài khoản thành công!', type: 'success' });
          await loadData();
          onAccountSwitched?.();
        }}
        onCapture={handleCapture}
        onManualAdd={handleManualAdd}
      />

      <SafeSwitchModal
        isOpen={isSafeSwitchModalOpen}
        onClose={() => setIsSafeSwitchModalOpen(false)}
        targetAccount={safeSwitchTarget}
        warningMessage={safeSwitchWarning}
        onConfirmSwitch={(_accountId, forceClose, relaunch) =>
          safeSwitchTarget
            ? handleSwitch(safeSwitchTarget, forceClose, relaunch)
            : Promise.resolve()
        }
      />
    </div>
  );
};
