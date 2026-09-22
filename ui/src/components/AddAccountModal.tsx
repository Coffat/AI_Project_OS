import React, { useState, useEffect, useRef } from 'react';
import { Modal } from './Modal.js';
import {
  UIProviderType,
  UICaptureAccountInput,
  UIAddAccountManualInput,
  UIOAuthSession,
} from '../types.js';
import { apiClient } from '../api/client.js';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onCapture: (data: UICaptureAccountInput) => Promise<void>;
  onManualAdd: (data: UIAddAccountManualInput) => Promise<void>;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onCapture,
  onManualAdd,
}) => {
  const [tab, setTab] = useState<'oauth' | 'capture' | 'manual'>('oauth');
  const [provider, setProvider] = useState<UIProviderType>('antigravity');
  const [name, setName] = useState('Google Antigravity Account');
  const [accountLabel, setAccountLabel] = useState('pro-tier');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [rawConfig, setRawConfig] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // OAuth Session State (Cockpit style)
  const [oauthSession, setOauthSession] = useState<UIOAuthSession | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [manualCodeOrEmail, setManualCodeOrEmail] = useState('');
  const [clientIdVersion, setClientIdVersion] = useState<'v1' | 'v2' | 'custom'>('v1');
  const [customClientId, setCustomClientId] = useState('');
  const pollIntervalRef = useRef<any>(null);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setOauthSession(null);
      setIsPolling(false);
      setErrorMsg(null);
      setCopySuccess(false);
    }
  }, [isOpen]);

  // Clean up polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const handleProviderChange = (val: UIProviderType) => {
    setProvider(val);
    if (val === 'antigravity') setName('Google Antigravity Account');
    else if (val === 'cursor') setName('Cursor Account');
    else if (val === 'windsurf') setName('Windsurf Account');
    else if (val === 'copilot') setName('Copilot Account');
    else if (val === 'claude') setName('Claude Account');
    else setName('OpenAI Account');
  };

  const handleStartOAuth = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    try {
      const res = await apiClient.startOAuthLogin({
        provider,
        name: name.trim() || undefined,
        accountLabel: accountLabel.trim() || undefined,
        openBrowser: true,
        clientIdVersion:
          provider === 'antigravity'
            ? clientIdVersion === 'custom' && customClientId.trim()
              ? customClientId.trim()
              : clientIdVersion
            : undefined,
      });

      if (res.success && res.session) {
        setOauthSession(res.session);
        setIsPolling(true);

        // Try opening in new tab in case OS level open was blocked
        try {
          window.open(res.session.loginUrl, '_blank');
        } catch {
          // Browser popup blocker handled by UI button
        }

        // Start polling for completion
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await apiClient.getOAuthStatus(res.session.state);
            if (statusRes.session && statusRes.session.status === 'completed') {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setIsPolling(false);
              onSuccess?.();
              onClose();
            } else if (statusRes.session && statusRes.session.status === 'failed') {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
              setIsPolling(false);
              setErrorMsg(statusRes.session.error || 'OAuth Authentication failed');
            }
          } catch {
            // Ignore polling network glitches
          }
        }, 1500);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualCompleteOAuth = async () => {
    if (!oauthSession) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.completeOAuthCallback({
        state: oauthSession.state,
        email: manualCodeOrEmail.trim() || undefined,
      });
      if (res.success) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        onSuccess?.();
        onClose();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (!oauthSession?.loginUrl) return;
    try {
      await navigator.clipboard.writeText(oauthSession.loginUrl);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setErrorMsg('Không thể copy link tự động. Hãy chọn toàn bộ link và copy thủ công.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === 'oauth') {
      if (!oauthSession) {
        await handleStartOAuth();
      }
      return;
    }

    if (!name.trim()) {
      setErrorMsg('Tên cấu hình tài khoản không được để trống');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      if (tab === 'capture') {
        await onCapture({
          provider,
          name: name.trim(),
          accountLabel: accountLabel.trim() || 'standard',
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
        });
      } else {
        await onManualAdd({
          provider,
          name: name.trim(),
          accountLabel: accountLabel.trim() || 'imported',
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
          rawConfigJson: rawConfig.trim() || undefined,
        });
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Thêm & Đăng Nhập Tài Khoản AI">
      <div className="flex flex-col gap-4 text-xs">
        {/* Anti-ban Security Banner */}
        <div className="p-3 bg-cyan-950/40 border border-cyan-800/60 rounded-lg flex items-start gap-2.5 text-cyan-200">
          <svg className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <div>
            <span className="font-bold text-cyan-300 block">Anti-Ban Protection Engine</span>
            <span>
              Mỗi tài khoản được gán một Machine ID ảo cố định và độc lập. Không spam quota, tuyệt đối an toàn khi chuyển đổi tài khoản.
            </span>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex rounded-lg bg-slate-950 border border-slate-800 p-1">
          <button
            type="button"
            onClick={() => { setTab('oauth'); setErrorMsg(null); }}
            className={`flex-1 py-1.5 rounded-md font-semibold transition flex items-center justify-center gap-1.5 ${
              tab === 'oauth'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🔗 Đăng Nhập Web (Cockpit)</span>
          </button>
          <button
            type="button"
            onClick={() => { setTab('capture'); setErrorMsg(null); }}
            className={`flex-1 py-1.5 rounded-md font-semibold transition ${
              tab === 'capture'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Snapshot từ IDE
          </button>
          <button
            type="button"
            onClick={() => { setTab('manual'); setErrorMsg(null); }}
            className={`flex-1 py-1.5 rounded-md font-semibold transition ${
              tab === 'manual'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Nhập Token/JSON
          </button>
        </div>

        {errorMsg && (
          <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 font-medium">
            {errorMsg}
          </div>
        )}

        {/* Form Body */}
        {tab === 'oauth' && oauthSession ? (
          /* Active OAuth Session Flow (Cockpit Style) */
          <div className="flex flex-col gap-3.5 bg-slate-950/70 border border-indigo-900/50 p-4 rounded-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-semibold text-slate-200 text-sm">Đang chờ bạn đăng nhập...</span>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                {provider.toUpperCase()}
              </span>
            </div>

            <p className="text-slate-400 text-xs leading-relaxed">
              Trang đăng nhập đã được mở trên trình duyệt. Nếu trình duyệt chặn mở tự động, hãy sao chép đường link bên dưới hoặc bấm nút <strong>Mở Trình Duyệt</strong>:
            </p>

            {/* Login Link Box */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={oauthSession.loginUrl}
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-cyan-300 select-all focus:outline-hidden"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition shrink-0 flex items-center gap-1 border border-slate-700"
              >
                {copySuccess ? 'Đã copy! ✅' : 'Sao chép'}
              </button>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => window.open(oauthSession.loginUrl, '_blank')}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/30"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Mở Lại Trong Trình Duyệt
              </button>
            </div>

            {/* Live Polling Status */}
            <div className="p-3 bg-slate-900/90 rounded-lg border border-slate-800 flex items-center justify-between text-xs mt-1">
              <div className="flex items-center gap-2 text-slate-300">
                <svg className="w-4 h-4 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>{isPolling ? 'Hệ thống đang tự động lắng nghe phản hồi...' : 'Đã dừng kiểm tra'}</span>
              </div>
            </div>

            {/* Manual Confirmation Fallback */}
            <div className="border-t border-slate-800/80 pt-3 mt-1">
              <label className="text-slate-400 text-[11px] block mb-1.5">
                Hoặc nhập Email tài khoản để xác nhận liên kết ngay nếu không tự động chuyển hướng:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="user@example.com"
                  value={manualCodeOrEmail}
                  onChange={(e) => setManualCodeOrEmail(e.target.value)}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-hidden focus:border-cyan-500"
                />
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleManualCompleteOAuth}
                  className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs transition disabled:opacity-50"
                >
                  Xác Nhận Ngay
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => {
                  if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
                  setOauthSession(null);
                }}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
              >
                Quay lại
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label className="text-slate-300 font-semibold block mb-1">Nền Tảng AI / Provider</label>
              <select
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value as UIProviderType)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-hidden focus:border-cyan-500"
              >
                <option value="antigravity">Google Antigravity</option>
                <option value="cursor">Cursor IDE</option>
                <option value="windsurf">Windsurf</option>
                <option value="copilot">GitHub Copilot / VS Code</option>
                <option value="claude">Claude Code (CLI)</option>
                <option value="openai">OpenAI / Codex</option>
              </select>
            </div>

            {tab === 'oauth' && provider === 'antigravity' && (
              <div className="p-3 bg-indigo-950/40 border border-indigo-850 rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-indigo-300">Google OAuth Client ID</span>
                  <span className="text-[10px] text-slate-400">Trích xuất từ Antigravity IDE</span>
                </div>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="radio"
                      name="clientIdVersion"
                      value="v1"
                      checked={clientIdVersion === 'v1'}
                      onChange={() => setClientIdVersion('v1')}
                      className="accent-indigo-500"
                    />
                    <span>Main Client (v1)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="radio"
                      name="clientIdVersion"
                      value="v2"
                      checked={clientIdVersion === 'v2'}
                      onChange={() => setClientIdVersion('v2')}
                      className="accent-indigo-500"
                    />
                    <span>Alt Client (v2)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="radio"
                      name="clientIdVersion"
                      value="custom"
                      checked={clientIdVersion === 'custom'}
                      onChange={() => setClientIdVersion('custom')}
                      className="accent-indigo-500"
                    />
                    <span>Tự nhập</span>
                  </label>
                </div>
                {clientIdVersion === 'custom' && (
                  <input
                    type="text"
                    value={customClientId}
                    onChange={(e) => setCustomClientId(e.target.value)}
                    placeholder="xxx.apps.googleusercontent.com"
                    className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-[11px] text-slate-200 font-mono focus:outline-hidden focus:border-cyan-500"
                  />
                )}
                <div className="p-2 rounded bg-emerald-950/50 border border-emerald-800/60 text-emerald-300 text-[11px] leading-relaxed">
                  💡 <strong>Gợi ý:</strong> Bạn đã đăng nhập sẵn trong <strong>Antigravity IDE</strong> trên máy này. Bạn có thể chọn tab <strong>Snapshot từ IDE</strong> ở trên để nạp tài khoản Pro ngay lập tức mà không cần xác thực web!
                </div>
              </div>
            )}

            {tab === 'capture' && provider === 'antigravity' && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-lg text-emerald-300 text-xs leading-relaxed">
                <div className="font-semibold text-emerald-200 mb-1">✅ Đã phát hiện cấu hình Antigravity IDE trên máy:</div>
                <div className="font-mono text-[10px] text-slate-400 bg-slate-950/60 p-1.5 rounded border border-emerald-900/40">
                  ~/Library/Application Support/Antigravity IDE
                </div>
                <div className="mt-1.5">
                  Nhấp nút <strong>"Chụp Phiên IDE Hiện Tại"</strong> bên dưới để trích xuất ngay tài khoản Google AI Pro vào hệ thống.
                </div>
              </div>
            )}

            <div>
              <label className="text-slate-300 font-semibold block mb-1">Tên Hồ Sơ (Profile Name) *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Google Antigravity Pro 1, Tài khoản Công Ty"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-hidden focus:border-cyan-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Phân Loại / Gói</label>
                <input
                  type="text"
                  value={accountLabel}
                  onChange={(e) => setAccountLabel(e.target.value)}
                  placeholder="VD: pro-tier, ultra, trial"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-hidden focus:border-cyan-500"
                />
              </div>
              {tab !== 'oauth' && (
                <div>
                  <label className="text-slate-300 font-semibold block mb-1">Email Tài Khoản</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-hidden focus:border-cyan-500"
                  />
                </div>
              )}
            </div>

            {tab === 'manual' && (
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Cấu Hình JSON / API Token</label>
                <textarea
                  rows={3}
                  value={rawConfig}
                  onChange={(e) => setRawConfig(e.target.value)}
                  placeholder='{"apiKey": "...", "model": "..."}'
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 font-mono text-[11px] focus:outline-hidden focus:border-cyan-500"
                />
              </div>
            )}

            {tab !== 'oauth' && (
              <div>
                <label className="text-slate-300 font-semibold block mb-1">Ghi Chú (Tùy chọn)</label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ghi chú thêm về tài khoản này"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-200 focus:outline-hidden focus:border-cyan-500"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-linear-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shadow-lg shadow-cyan-500/10"
              >
                {isSubmitting
                  ? 'Đang xử lý...'
                  : tab === 'oauth'
                  ? '🚀 Tạo Link & Đăng Nhập'
                  : tab === 'capture'
                  ? '📸 Chụp Phiên IDE Hiện Tại'
                  : 'Lưu Cấu Hình'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
};
