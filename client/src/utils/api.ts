import axios from 'axios';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/+$/, '');

export interface User {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
}

export interface ApiKey {
  id: string;
  name: string | null;
  created_at: string;
  last_used: string | null;
  revoked: boolean;
}

export interface AlertEvent {
  id: string;
  fired_at: string;
  rule_name?: string;
  details?: {
    service?: string;
    anomaly_count?: number;
  };
}

export interface AlertRule {
  id: string;
  name?: string;
  service?: string;
  condition?: {
    type?: string;
  };
  active: boolean;
}

interface AuthResponse {
  user: User;
  token: string;
}

interface CreateProjectResponse {
  project: Project;
  api_key: string;
  message: string;
}

interface CreateOwnedApiKeyResponse {
  api_key: string;
  key: ApiKey;
  message: string;
}

interface ApiCredentials {
  userToken: string | null;
  projectApiKey: string | null;
}

function requireUserHeaders(token: string | null): Record<string, string> {
  if (!token) throw new Error('User session is required');
  return { Authorization: `Bearer ${token}` };
}

function requireProjectHeaders(apiKey: string | null): Record<string, string> {
  if (!apiKey) throw new Error('Select a project with a saved API key');
  return { Authorization: `Bearer ${apiKey}` };
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') searchParams.set(key, String(value));
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return error instanceof Error ? error.message : fallback;
  const data = error.response?.data;
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  return fallback;
}

export const publicApi = {
  async register(input: { email: string; password: string; name?: string }) {
    const { data } = await axios.post<AuthResponse>(`${API_BASE_URL}/auth/register`, input);
    return data;
  },

  async login(input: { email: string; password: string }) {
    const { data } = await axios.post<AuthResponse>(`${API_BASE_URL}/auth/login`, input);
    return data;
  },
};

export function createApiClient(credentials: ApiCredentials) {
  const userHeaders = () => requireUserHeaders(credentials.userToken);
  const projectHeaders = () => requireProjectHeaders(credentials.projectApiKey);

  return {
    async getCurrentUser() {
      const { data } = await axios.get<{ user: User }>(`${API_BASE_URL}/auth/me`, {
        headers: userHeaders(),
      });
      return data.user;
    },

    async getProjects() {
      const { data } = await axios.get<Project[]>(`${API_BASE_URL}/projects`, {
        headers: userHeaders(),
      });
      return data;
    },

    async createProject(name: string) {
      const { data } = await axios.post<CreateProjectResponse>(
        `${API_BASE_URL}/projects`,
        { name },
        { headers: userHeaders() },
      );
      return data;
    },

    async getOwnedApiKeys(projectId: string) {
      const { data } = await axios.get<ApiKey[]>(`${API_BASE_URL}/projects/${projectId}/api-keys`, {
        headers: userHeaders(),
      });
      return data;
    },

    async createOwnedApiKey(projectId: string, name?: string) {
      const { data } = await axios.post<CreateOwnedApiKeyResponse>(
        `${API_BASE_URL}/projects/${projectId}/api-keys`,
        { name },
        { headers: userHeaders() },
      );
      return data;
    },

    async revokeOwnedApiKey(projectId: string, keyId: string) {
      const { data } = await axios.delete<{ message: string }>(
        `${API_BASE_URL}/projects/${projectId}/api-keys/${keyId}`,
        { headers: userHeaders() },
      );
      return data;
    },

    async verifyProjectApiKey(rawApiKey: string) {
      const { data } = await axios.get<{ project_id: string }>(`${API_BASE_URL}/project-context`, {
        headers: requireProjectHeaders(rawApiKey),
      });
      return data;
    },

    async getApiKeys() {
      const { data } = await axios.get<ApiKey[]>(`${API_BASE_URL}/api-keys`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async createApiKey(name?: string) {
      const { data } = await axios.post<{ api_key: string }>(
        `${API_BASE_URL}/api-keys`,
        { name },
        { headers: projectHeaders() },
      );
      return data;
    },

    async revokeApiKey(id: string) {
      const { data } = await axios.delete<{ message: string }>(`${API_BASE_URL}/api-keys/${id}`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async getLogs(params: Record<string, string> = {}) {
      const { data } = await axios.get(`${API_BASE_URL}/logs${toQuery(params)}`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async search(query: string, params: Record<string, string> = {}) {
      const { data } = await axios.get(
        `${API_BASE_URL}/search${toQuery({ q: query, ...params })}`,
        { headers: projectHeaders() },
      );
      return data;
    },

    async structuredSearch(query: string, params: Record<string, string> = {}) {
      const { data } = await axios.get(
        `${API_BASE_URL}/search/structured${toQuery({ q: query, ...params })}`,
        { headers: projectHeaders() },
      );
      return data;
    },

    async streamSearch(query: string, params: Record<string, string> = {}) {
      return fetch(`${API_BASE_URL}/search/stream${toQuery({ q: query, ...params })}`, {
        headers: {
          ...projectHeaders(),
          Accept: 'text/event-stream',
        },
      });
    },

    async agentQuery(question: string) {
      const { data } = await axios.post(
        `${API_BASE_URL}/agent/query`,
        { question },
        { headers: projectHeaders() },
      );
      return data;
    },

    async getStats(hours = 24) {
      const { data } = await axios.get(`${API_BASE_URL}/stats${toQuery({ hours })}`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async getServices() {
      const { data } = await axios.get(`${API_BASE_URL}/services`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async getAlerts() {
      const { data } = await axios.get<AlertEvent[]>(`${API_BASE_URL}/alerts`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async getAlertRules() {
      const { data } = await axios.get<AlertRule[]>(`${API_BASE_URL}/alert-rules`, {
        headers: projectHeaders(),
      });
      return data;
    },

    async createAlertRule(rule: {
      name: string;
      condition: object;
      service: string;
      notify_url: string;
    }) {
      const { data } = await axios.post(`${API_BASE_URL}/alert-rules`, rule, {
        headers: projectHeaders(),
      });
      return data;
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
