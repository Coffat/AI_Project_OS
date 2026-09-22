import type {
  FullDashboardState,
  UIHeaderState,
  UITaskPanelState,
  UITaskStepItem,
  UIRelevantFileItem,
  UIRelevantSymbolItem,
  UIContextPanelState,
  UIDecisionRecord,
  UIConstraintRecord,
  UIMemoryPanelState,
  UIGraphNode,
  UIGraphEdge,
  UIGraphPanelState,
  UIExecutionSessionRecord,
  UIHandoffPanelState,
  UIValidationGateState,
  UIValidationPanelState,
  UIAgentPanelState,
  ResumeTaskInput,
  SaveHandoffInput,
  ValidateTaskInput,
  RecordProgressInput,
  UIProviderType,
  UIProviderAccount,
  UIQuotaInfo,
  UIFingerprint,
  UICaptureAccountInput,
  UIAddAccountManualInput,
  UISwitchAccountInput,
  UISwitchAccountResult,
  UIProviderCockpitState,
  UIOAuthSession,
  UIStartOAuthInput,
  UIProjectInfo,
  UIProjectsState,
  CreateProjectInput,
  SwitchProjectInput,
} from '../types.js';

export type {
  FullDashboardState,
  UIHeaderState,
  UITaskPanelState,
  UITaskStepItem,
  UIRelevantFileItem,
  UIRelevantSymbolItem,
  UIContextPanelState,
  UIDecisionRecord,
  UIConstraintRecord,
  UIMemoryPanelState,
  UIGraphNode,
  UIGraphEdge,
  UIGraphPanelState,
  UIExecutionSessionRecord,
  UIHandoffPanelState,
  UIValidationGateState,
  UIValidationPanelState,
  UIAgentPanelState,
  ResumeTaskInput,
  SaveHandoffInput,
  ValidateTaskInput,
  RecordProgressInput,
  UIProviderType,
  UIProviderAccount,
  UIQuotaInfo,
  UIFingerprint,
  UICaptureAccountInput,
  UIAddAccountManualInput,
  UISwitchAccountInput,
  UISwitchAccountResult,
  UIProviderCockpitState,
  UIOAuthSession,
  UIStartOAuthInput,
  UIProjectInfo,
  UIProjectsState,
  CreateProjectInput,
  SwitchProjectInput,
};

const BASE_URL = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let errorMsg = `HTTP Error ${res.status}: ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) errorMsg = data.error;
    } catch {
      // fallback to statusText
    }
    throw new Error(errorMsg);
  }

  return (await res.json()) as T;
}

export const apiClient = {
  getDashboard: (taskId?: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (taskId) params.append('taskId', taskId);
    if (projectId) params.append('projectId', projectId);
    const qs = params.toString();
    return request<FullDashboardState>(`/api/dashboard${qs ? `?${qs}` : ''}`);
  },

  getProjects: () => request<UIProjectsState>('/api/projects'),

  switchProject: (projectId: string) =>
    request<{ success: boolean; project: UIProjectInfo }>('/api/projects/switch', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),

  createProject: (data: CreateProjectInput) =>
    request<{ success: boolean; project: UIProjectInfo }>('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getHeader: (projectId?: string) =>
    request<UIHeaderState>(`/api/header${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`),

  getTask: (taskId?: string) =>
    request<UITaskPanelState>(`/api/task${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),

  getContext: (taskId?: string, budget = 8000) =>
    request<UIContextPanelState>(
      `/api/context?budget=${budget}${taskId ? `&taskId=${encodeURIComponent(taskId)}` : ''}`
    ),

  getMemory: () => request<UIMemoryPanelState>('/api/memory'),

  getGraph: () => request<UIGraphPanelState>('/api/graph'),

  getHandoff: (taskId?: string) =>
    request<UIHandoffPanelState>(`/api/handoff${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),

  getValidation: (taskId?: string) =>
    request<UIValidationPanelState>(`/api/validation${taskId ? `?taskId=${encodeURIComponent(taskId)}` : ''}`),

  getAgent: () => request<UIAgentPanelState>('/api/agent'),

  resumeTask: (data: ResumeTaskInput) =>
    request<{ success: boolean; result: unknown }>('/api/actions/resume', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  saveHandoff: (data: SaveHandoffInput) =>
    request<{ success: boolean; result: unknown }>('/api/actions/handoff', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  runValidation: (data: ValidateTaskInput) =>
    request<{ success: boolean; result: unknown }>('/api/actions/validate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  recordProgress: (data: RecordProgressInput) =>
    request<{ success: boolean; result: unknown }>('/api/actions/progress', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProviderCockpit: () => request<UIProviderCockpitState>('/api/providers/accounts'),

  captureProviderAccount: (data: UICaptureAccountInput) =>
    request<{ success: boolean; account: UIProviderAccount }>('/api/providers/accounts/capture', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  addProviderAccount: (data: UIAddAccountManualInput) =>
    request<{ success: boolean; account: UIProviderAccount }>('/api/providers/accounts/add', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  switchProviderAccount: (data: UISwitchAccountInput) =>
    request<UISwitchAccountResult>('/api/providers/accounts/switch', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  refreshProviderQuota: (accountId: string) =>
    request<{ success: boolean; quota: UIQuotaInfo }>('/api/providers/accounts/quota', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),

  deleteProviderAccount: (accountId: string) =>
    request<{ success: boolean }>(`/api/providers/accounts?id=${encodeURIComponent(accountId)}`, {
      method: 'DELETE',
    }),

  launchProviderInstance: (provider: UIProviderType) =>
    request<{ launched: boolean; message: string }>('/api/providers/instances/launch', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),

  startOAuthLogin: (data: UIStartOAuthInput) =>
    request<{ success: boolean; session: UIOAuthSession }>('/api/providers/oauth/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getOAuthStatus: (state: string) =>
    request<{ session: UIOAuthSession | null }>(`/api/providers/oauth/status?state=${encodeURIComponent(state)}`),

  completeOAuthCallback: (data: { state: string; code?: string; email?: string }) =>
    request<{ success: boolean; account: UIProviderAccount }>('/api/providers/oauth/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
