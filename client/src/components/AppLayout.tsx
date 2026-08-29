import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/projects', label: 'Projects' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/alerts', label: 'Alerts' },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const {
    user,
    projects,
    selectedProjectId,
    hasProjectApiKey,
    selectProject,
    logout,
  } = useSession();

  function handleProjectChange(projectId: string) {
    selectProject(projectId);
    navigate(hasProjectApiKey(projectId) ? '/dashboard' : '/projects');
  }

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-4 justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Log Drain</h1>
            <p className="text-sm text-gray-500">AI-powered log analysis</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <nav className="flex items-center gap-1" aria-label="Primary navigation">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <select
              aria-label="Selected project"
              value={selectedProjectId || ''}
              onChange={(event) => handleProjectChange(event.target.value)}
              disabled={projects.length === 0}
              className="max-w-48 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:text-gray-400"
            >
              {projects.length === 0 ? (
                <option value="">No projects</option>
              ) : (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}{hasProjectApiKey(project.id) ? '' : ' (key needed)'}
                  </option>
                ))
              )}
            </select>

            <span className="hidden lg:inline text-sm text-gray-500" title={user?.email}>
              {user?.name || user?.email}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-md px-2.5 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
