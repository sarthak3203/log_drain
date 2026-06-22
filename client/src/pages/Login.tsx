import { useState } from "react";
import { api } from "../utils/api";
interface LoginProps {
  onLogin: () => void;
}
export default function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<"login" | "create">("login");
  const [apiKey, setApiKey] = useState("");
  const [projectName, setProjectName] = useState("");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    localStorage.setItem("api_key", apiKey.trim());
    onLogin();
  }
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await api.createProject(projectName);
      setNewKey(result.api_key);
    } catch (err) {
      setError("Failed to create project");
    }
  }
  if (newKey) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-xl border border-gray-200 p8">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">
            Project created!
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Save your API key — it won't be shown again.
          </p>
          <div
            className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg
break-all mb-4"
          >
            {newKey}
          </div>
          <button
            onClick={() => {
              localStorage.setItem("api_key", newKey);
              onLogin();
            }}
            className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm fontmedium hover:bg-blue-700"
          >
            Continue to dashboard
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Log Drain</h1>
          <p className="text-gray-500 text-sm mt-1">
            AI-powered semantic log search
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-8">
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setMode("login")}
              className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
                mode === "login"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Use existing key
            </button>
            <button
              onClick={() => setMode("create")}
              className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
                mode === "create"
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Create project
            </button>
          </div>
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="log_abc123..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm
font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm fontmedium hover:bg-blue-700"
              >
                Open dashboard
              </button>
            </form>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My project"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm
focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm fontmedium hover:bg-blue-700"
              >
                Create project & get API key
              </button>
            </form>
          )}
        </div>
        <div className="mt-6 bg-gray-900 rounded-xl p-5 text-sm">
          <p className="text-gray-400 mb-3 text-xs font-medium uppercase trackingwider">
            Quick start
          </p>
          <p className="text-green-400 font-mono text-xs">
            {`curl -X POST http://localhost:3000/api/v1/logs \\`}
            <br />
            {` -H "Authorization: Bearer YOUR_KEY" \\`}
            <br />
            {` -H "Content-Type: application/json" \\`}
            <br />
            {` -d '{"level":"ERROR","message":"DB connection
refused","service":"api"}'`}
          </p>
        </div>
      </div>
    </div>
  );
}
