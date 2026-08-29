import { useEffect, useState, type FormEvent } from 'react';
import OneTimeKeyDialog from '../components/OneTimeKeyDialog';
import { useSession } from '../context/SessionContext';
import { getErrorMessage, type ApiKey } from '../utils/api';

export default function ApiKeys() {
  const { api, selectedProject, rememberProjectApiKey } = useSession();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);

  async function loadKeys() {
    try {
      if (!selectedProject) return;
      setKeys(await api.getOwnedApiKeys(selectedProject.id));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load API keys'));
    }
  }

  useEffect(() => {
    let active = true;
    void api
      .getOwnedApiKeys(selectedProject!.id)
      .then((nextKeys) => {
        if (active) setKeys(nextKeys);
      })
      .catch((err: unknown) => {
        if (active) setError(getErrorMessage(err, 'Failed to load API keys'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, selectedProject]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      if (!selectedProject) return;
      const result = await api.createOwnedApiKey(selectedProject.id, name.trim() || undefined);
      setName('');
      setNewKey(result.api_key);
      await rememberProjectApiKey(selectedProject.id, result.api_key);
      await loadKeys();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to create API key'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKey) {
    const confirmed = window.confirm(
      `Revoke "${key.name || 'unnamed key'}"? This cannot be undone. It may be the key currently used by this dashboard.`,
    );
    if (!confirmed) return;

    try {
      if (!selectedProject) return;
      await api.revokeOwnedApiKey(selectedProject.id, key.id);
      await loadKeys();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to revoke API key'));
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">API Keys</h2>
        <p className="mt-1 text-sm text-gray-500">
          Manage keys for <span className="font-medium text-gray-700">{selectedProject?.name}</span>.
        </p>
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Create API key</h3>
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            placeholder="Key name (optional)"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create API key'}
          </button>
        </form>
        <p className="mt-3 text-xs text-gray-500">The raw value is shown only once after creation.</p>
      </section>

      <section className="bg-white rounded-lg border border-gray-200">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="text-sm font-medium text-gray-700">Stored key metadata</h3>
        </div>
        {error && <p className="px-6 pt-4 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-gray-400">Loading API keys...</p>
        ) : keys.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-gray-400">No API keys found.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {keys.map((key) => (
              <div key={key.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div>
                  <p className="text-sm font-medium text-gray-900">{key.name || 'Unnamed key'}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    Created {new Date(key.created_at).toLocaleString()}
                    {key.last_used ? ` · Last used ${new Date(key.last_used).toLocaleString()}` : ' · Never used'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    key.revoked ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'
                  }`}>
                    {key.revoked ? 'Revoked' : 'Active'}
                  </span>
                  {!key.revoked && (
                    <button
                      onClick={() => void handleRevoke(key)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {newKey && (
        <OneTimeKeyDialog
          title="New project API key"
          apiKey={newKey}
          description="This raw value is available only now. Existing key records show metadata, never their secret values."
          onClose={() => setNewKey(null)}
        />
      )}
    </main>
  );
}
