import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { useSession } from './context/SessionContext';
import ApiKeys from './pages/ApiKeys';
import Alerts from './pages/Alerts';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Projects from './pages/Projects';
import Register from './pages/Register';

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500">
      {children}
    </div>
  );
}

function RequireAuth() {
  const { status } = useSession();
  if (status === 'restoring') return <FullPageMessage>Restoring your session...</FullPageMessage>;
  if (status !== 'authenticated') return <Navigate to="/login" replace />;
  return <Outlet />;
}

function PublicOnly() {
  const { status } = useSession();
  if (status === 'restoring') return <FullPageMessage>Restoring your session...</FullPageMessage>;
  if (status === 'authenticated') return <Navigate to="/projects" replace />;
  return <Outlet />;
}

function RequireProjectKey() {
  const { selectedProject, selectedProjectApiKey } = useSession();
  if (!selectedProject || !selectedProjectApiKey) return <Navigate to="/projects" replace />;
  return <Outlet />;
}

function RequireSelectedProject() {
  const { selectedProject } = useSession();
  if (!selectedProject) return <Navigate to="/projects" replace />;
  return <Outlet />;
}

function DashboardRoute() {
  const { selectedProject } = useSession();
  return <Dashboard key={selectedProject?.id || 'no-project'} />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<Projects />} />
          <Route element={<RequireSelectedProject />}>
            <Route path="/api-keys" element={<ApiKeys />} />
          </Route>
          <Route element={<RequireProjectKey />}>
            <Route path="/dashboard" element={<DashboardRoute />} />
            <Route path="/alerts" element={<Alerts />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
