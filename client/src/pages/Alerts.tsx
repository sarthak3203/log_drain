import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSession } from '../context/SessionContext';
import { getErrorMessage, type AlertEvent, type AlertRule } from '../utils/api';

export default function Alerts() {
  const { api, selectedProject } = useSession();
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadAlerts() {
      setLoading(true);
      setError('');
      try {
        const [events, alertRules] = await Promise.all([api.getAlerts(), api.getAlertRules()]);
        if (!active) return;
        setAlerts(events || []);
        setRules(alertRules || []);
      } catch (err: unknown) {
        if (!active) return;
        setError(getErrorMessage(err, 'Failed to load alerts'));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadAlerts();
    return () => {
      active = false;
    };
  }, [api]);

  return (
    <main className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <section>
        <h2 className="text-xl font-semibold text-gray-900">Alerts</h2>
        <p className="mt-1 text-sm text-gray-500">
          Alert activity and rules for <span className="font-medium text-gray-700">{selectedProject?.name}</span>.
        </p>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="bg-white rounded-lg border border-red-200 p-6">
        <h3 className="text-sm font-medium text-red-700 mb-4 flex items-center gap-2">
          <AlertTriangle size={14} />
          Recent anomaly alerts
        </h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading alerts...</p>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-gray-400">No recent alert events for this project.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-3">
                <span className="shrink-0 text-xs font-medium text-red-500">
                  {new Date(alert.fired_at).toLocaleString()}
                </span>
                <div>
                  <p className="text-sm font-medium text-red-800">{alert.rule_name || 'Anomaly alert'}</p>
                  <p className="mt-0.5 text-xs text-red-600">
                    Service: {alert.details?.service || 'unknown'} · {alert.details?.anomaly_count || 0} anomalous logs
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-medium text-gray-700 mb-4">Alert rules</h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading alert rules...</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-400">No alert rules configured for this project.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{rule.name || 'Unnamed rule'}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Service: {rule.service || 'All'} · Type: {rule.condition?.type || 'unknown'}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                  rule.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {rule.active ? 'Active' : 'Inactive'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
