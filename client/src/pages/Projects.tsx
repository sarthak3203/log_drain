import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import OneTimeKeyDialog from '../components/OneTimeKeyDialog';
import { useSession } from '../context/SessionContext';
import { getErrorMessage } from '../utils/api';

export default function Projects() {
  const navigate = useNavigate();
  const {
    projects,
    selectedProjectId,
    createProject,
    createOwnedProjectApiKey,
    selectProject,
    rememberProjectApiKey,
    hasProjectApiKey,
  } = useSession();
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [recoveringProjectId, setRecoveringProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [keyInputForProject, setKeyInputForProject] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState('');
  const [oneTimeKey, setOneTimeKey] = useState<{ projectId: string; projectName: string; apiKey: string } | null>(null);

  async function handleCreateProject(event: FormEvent) {
    event.preventDefault();
    const name = projectName.trim();
    if (!name) return;

    setCreating(true);
    setError('');
    try {
      const result = await createProject(name);
      setProjectName('');
      setOneTimeKey({ projectId: result.project.id, projectName: result.project.name, apiKey: result.apiKey });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create project'));
    } finally {
      setCreating(false);
    }
  }

  function selectAndOpenDashboard(projectId: string) {
    selectProject(projectId);
    navigate('/dashboard');
  }

  async function saveExistingKey(projectId: string) {
    try {
      await rememberProjectApiKey(projectId, savedKey);
      setSavedKey('');
      setKeyInputForProject(null);
      selectAndOpenDashboard(projectId);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to save this API key'));
    }
  }

  async function recoverProject(projectId: string, projectName: string) {
    setRecoveringProjectId(projectId);
    setError('');
    try {
      const result = await createOwnedProjectApiKey(projectId, 'Recovery key');
      setOneTimeKey({ projectId, projectName, apiKey: result.apiKey });
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to create a recovery API key'));
    } finally {
      setRecoveringProjectId(null);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Projects</h2>
          <p className="mt-1 text-sm text-gray-500">Create, select, and connect the projects you own.</p>
        </div>
      </section>

      <section className="max-w-xl bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Create project</h3>
        <form onSubmit={handleCreateProject} className="flex flex-col sm:flex-row gap-3">
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            maxLength={100}
            placeholder="My project"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={creating || !projectName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create project'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-sm font-medium text-gray-700">Your projects</h3>
        </div>
        {projects.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-400">
            No projects yet. Create one to start sending and analyzing logs.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {projects.map((project) => {
              const keyAvailable = hasProjectApiKey(project.id);
              const isSelected = selectedProjectId === project.id;

              return (
                <div key={project.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">{project.name}</p>
                        {isSelected && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Selected
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          keyAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {keyAvailable ? 'API key saved' : 'API key needed'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Created {new Date(project.created_at).toLocaleString()}
                      </p>
                    </div>
                    {keyAvailable ? (
                      <button
                        onClick={() => selectAndOpenDashboard(project.id)}
                        className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Open dashboard
                      </button>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => {
                            setError('');
                            setSavedKey('');
                            setKeyInputForProject(project.id);
                          }}
                          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Add saved API key
                        </button>
                        <button
                          onClick={() => void recoverProject(project.id, project.name)}
                          disabled={recoveringProjectId === project.id}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {recoveringProjectId === project.id ? 'Creating key...' : 'Create recovery key'}
                        </button>
                      </div>
                    )}
                  </div>

                  {keyInputForProject === project.id && (
                    <div className="mt-4 rounded-lg bg-gray-50 p-4">
                      <p className="mb-2 text-xs text-gray-600">
                        Paste a raw key you saved when this project was created. Existing keys cannot be retrieved from the server.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={savedKey}
                          onChange={(event) => setSavedKey(event.target.value)}
                          placeholder="log_..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => void saveExistingKey(project.id)}
                          disabled={!savedKey.trim()}
                          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save and select
                        </button>
                        <button
                          onClick={() => setKeyInputForProject(null)}
                          className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {oneTimeKey && (
        <OneTimeKeyDialog
          title={`API key for ${oneTimeKey.projectName}`}
          apiKey={oneTimeKey.apiKey}
          description="Use this key for log ingestion and the selected project's dashboard."
          onClose={() => {
            setOneTimeKey(null);
            selectProject(oneTimeKey.projectId);
            navigate('/dashboard');
          }}
        />
      )}
    </main>
  );
}
