/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  createApiClient,
  publicApi,
  type ApiClient,
  type Project,
  type User,
} from '../utils/api';

const JWT_STORAGE_KEY = 'logdrain.user_jwt';
const selectedProjectStorageKey = (userId: string) => `logdrain.selected_project.${userId}`;
const projectKeyStorageKey = (userId: string) => `logdrain.project_api_keys.${userId}`;

type SessionStatus = 'restoring' | 'authenticated' | 'unauthenticated';
type ProjectApiKeyMap = Record<string, string>;

interface CreateProjectResult {
  project: Project;
  apiKey: string;
  message: string;
}

interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  jwt: string | null;
  projects: Project[];
  selectedProjectId: string | null;
  selectedProject: Project | null;
  selectedProjectApiKey: string | null;
  api: ApiClient;
  register: (input: { email: string; password: string; name?: string }) => Promise<void>;
  login: (input: { email: string; password: string }) => Promise<void>;
  logout: () => void;
  refreshProjects: () => Promise<void>;
  createProject: (name: string) => Promise<CreateProjectResult>;
  createOwnedProjectApiKey: (projectId: string, name?: string) => Promise<{ apiKey: string }>;
  selectProject: (projectId: string) => void;
  rememberProjectApiKey: (projectId: string, apiKey: string) => Promise<void>;
  forgetProjectApiKey: (projectId: string) => void;
  hasProjectApiKey: (projectId: string) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function readProjectApiKeys(userId: string): ProjectApiKeyMap {
  try {
    const stored = localStorage.getItem(projectKeyStorageKey(userId));
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return {};

    const keys: ProjectApiKeyMap = {};
    for (const [projectId, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.startsWith('log_')) {
        keys[projectId] = value;
      }
    }
    return keys;
  } catch {
    return {};
  }
}

function persistProjectApiKeys(userId: string, keys: ProjectApiKeyMap): void {
  localStorage.setItem(projectKeyStorageKey(userId), JSON.stringify(keys));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(() =>
    localStorage.getItem(JWT_STORAGE_KEY) ? 'restoring' : 'unauthenticated',
  );
  const [user, setUser] = useState<User | null>(null);
  const [jwt, setJwt] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectApiKeys, setProjectApiKeys] = useState<ProjectApiKeyMap>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const selectedProjectApiKey = selectedProjectId ? projectApiKeys[selectedProjectId] || null : null;

  const api = useMemo(
    () => createApiClient({ userToken: jwt, projectApiKey: selectedProjectApiKey }),
    [jwt, selectedProjectApiKey],
  );

  const applyUserSession = useCallback(async (token: string, authenticatedUser: User) => {
    localStorage.setItem(JWT_STORAGE_KEY, token);
    const nextProjects = await createApiClient({ userToken: token, projectApiKey: null }).getProjects();
    const nextKeys = readProjectApiKeys(authenticatedUser.id);
    const savedProjectId = localStorage.getItem(selectedProjectStorageKey(authenticatedUser.id));
    const nextSelectedProjectId = nextProjects.some((project) => project.id === savedProjectId)
      ? savedProjectId
      : nextProjects.find((project) => Boolean(nextKeys[project.id]))?.id || nextProjects[0]?.id || null;

    setJwt(token);
    setUser(authenticatedUser);
    setProjects(nextProjects);
    setProjectApiKeys(nextKeys);
    setSelectedProjectId(nextSelectedProjectId);
    setStatus('authenticated');
  }, []);

  useEffect(() => {
    let active = true;
    const storedToken = localStorage.getItem(JWT_STORAGE_KEY);

    if (!storedToken) {
      return () => {
        active = false;
      };
    }

    const restore = async () => {
      try {
        const sessionApi = createApiClient({ userToken: storedToken, projectApiKey: null });
        const restoredUser = await sessionApi.getCurrentUser();
        const restoredProjects = await sessionApi.getProjects();
        if (!active) return;

        const restoredKeys = readProjectApiKeys(restoredUser.id);
        const savedProjectId = localStorage.getItem(selectedProjectStorageKey(restoredUser.id));
        const restoredSelectedProjectId = restoredProjects.some(
          (project) => project.id === savedProjectId,
        )
          ? savedProjectId
          : restoredProjects.find((project) => Boolean(restoredKeys[project.id]))?.id ||
            restoredProjects[0]?.id ||
            null;

        setJwt(storedToken);
        setUser(restoredUser);
        setProjects(restoredProjects);
        setProjectApiKeys(restoredKeys);
        setSelectedProjectId(restoredSelectedProjectId);
        setStatus('authenticated');
      } catch {
        localStorage.removeItem(JWT_STORAGE_KEY);
        if (!active) return;
        setStatus('unauthenticated');
      }
    };

    void restore();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const response = await publicApi.login(input);
      await applyUserSession(response.token, response.user);
    },
    [applyUserSession],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      const response = await publicApi.register(input);
      await applyUserSession(response.token, response.user);
    },
    [applyUserSession],
  );

  const logout = useCallback(() => {
    if (user) {
      localStorage.removeItem(projectKeyStorageKey(user.id));
      localStorage.removeItem(selectedProjectStorageKey(user.id));
    }
    localStorage.removeItem(JWT_STORAGE_KEY);
    setUser(null);
    setJwt(null);
    setProjects([]);
    setProjectApiKeys({});
    setSelectedProjectId(null);
    setStatus('unauthenticated');
  }, [user]);

  const refreshProjects = useCallback(async () => {
    if (!user || !jwt) return;
    const refreshedProjects = await api.getProjects();
    setProjects(refreshedProjects);
    setSelectedProjectId((currentProjectId) => {
      if (refreshedProjects.some((project) => project.id === currentProjectId)) return currentProjectId;
      const fallbackProjectId = refreshedProjects.find((project) => projectApiKeys[project.id])?.id ||
        refreshedProjects[0]?.id ||
        null;
      if (fallbackProjectId) {
        localStorage.setItem(selectedProjectStorageKey(user.id), fallbackProjectId);
      }
      return fallbackProjectId;
    });
  }, [api, jwt, projectApiKeys, user]);

  const selectProject = useCallback(
    (projectId: string) => {
      if (!user || !projects.some((project) => project.id === projectId)) return;
      localStorage.setItem(selectedProjectStorageKey(user.id), projectId);
      setSelectedProjectId(projectId);
    },
    [projects, user],
  );

  const rememberProjectApiKey = useCallback(
    async (projectId: string, rawApiKey: string) => {
      if (!user) return;
      if (!projects.some((project) => project.id === projectId)) {
        throw new Error('Select one of your projects before saving an API key');
      }
      const apiKey = rawApiKey.trim();
      if (!apiKey.startsWith('log_')) {
        throw new Error('Project API keys start with log_');
      }
      const context = await api.verifyProjectApiKey(apiKey);
      if (context.project_id !== projectId) {
        throw new Error('This API key belongs to a different project');
      }
      const nextKeys = { ...projectApiKeys, [projectId]: apiKey };
      persistProjectApiKeys(user.id, nextKeys);
      setProjectApiKeys(nextKeys);
    },
    [api, projectApiKeys, projects, user],
  );

  const forgetProjectApiKey = useCallback(
    (projectId: string) => {
      if (!user) return;
      const nextKeys = { ...projectApiKeys };
      delete nextKeys[projectId];
      persistProjectApiKeys(user.id, nextKeys);
      setProjectApiKeys(nextKeys);
    },
    [projectApiKeys, user],
  );

  const createProject = useCallback(
    async (name: string): Promise<CreateProjectResult> => {
      if (!user) throw new Error('User session is required');
      const result = await api.createProject(name);
      const nextProjects = [result.project, ...projects.filter((project) => project.id !== result.project.id)];
      const nextKeys = { ...projectApiKeys, [result.project.id]: result.api_key };

      persistProjectApiKeys(user.id, nextKeys);
      localStorage.setItem(selectedProjectStorageKey(user.id), result.project.id);
      setProjects(nextProjects);
      setProjectApiKeys(nextKeys);
      setSelectedProjectId(result.project.id);

      return {
        project: result.project,
        apiKey: result.api_key,
        message: result.message,
      };
    },
    [api, projectApiKeys, projects, user],
  );

  const createOwnedProjectApiKey = useCallback(
    async (projectId: string, name?: string): Promise<{ apiKey: string }> => {
      if (!user || !projects.some((project) => project.id === projectId)) {
        throw new Error('Project ownership is required');
      }
      const result = await api.createOwnedApiKey(projectId, name);
      const nextKeys = { ...projectApiKeys, [projectId]: result.api_key };
      persistProjectApiKeys(user.id, nextKeys);
      setProjectApiKeys(nextKeys);
      return { apiKey: result.api_key };
    },
    [api, projectApiKeys, projects, user],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      jwt,
      projects,
      selectedProjectId,
      selectedProject,
      selectedProjectApiKey,
      api,
      register,
      login,
      logout,
      refreshProjects,
      createProject,
      createOwnedProjectApiKey,
      selectProject,
      rememberProjectApiKey,
      forgetProjectApiKey,
      hasProjectApiKey: (projectId) => Boolean(projectApiKeys[projectId]),
    }),
    [
      api,
      createProject,
      createOwnedProjectApiKey,
      forgetProjectApiKey,
      jwt,
      login,
      logout,
      projectApiKeys,
      projects,
      refreshProjects,
      register,
      rememberProjectApiKey,
      selectedProject,
      selectedProjectApiKey,
      selectedProjectId,
      selectProject,
      status,
      user,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within SessionProvider');
  return context;
}
