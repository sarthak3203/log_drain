import ReactMarkdown from 'react-markdown';
import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Search, AlertTriangle, Activity, Server } from "lucide-react";
import { api } from "../utils/api";
export default function Dashboard() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertRules, setAlertRules] = useState<any[]>([]);
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleService, setNewRuleService] = useState('');
  const [newRuleWebhook, setNewRuleWebhook] = useState('');
  const [creatingRule, setCreatingRule] = useState(false);
  const anomaliesRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  useEffect(() => {
    loadData();
    loadAlertRules();
    // Poll for new logs every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [levelFilter, serviceFilter]);
  const scrollToAnomalies = () => {
    anomaliesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  async function loadData() {
    try {
      const params: Record<string, string> = {};
      if (levelFilter) params.level = levelFilter;
      if (serviceFilter) params.service = serviceFilter;
      const [logsData, statsData, servicesData, alertsData] = await Promise.all([
        api.getLogs(params),
        api.getStats(24),
        api.getServices(),
        api.getAlerts(),
      ]);
      setLogs(logsData.logs || []);
      setStats(statsData);
      setServices(servicesData || []);
      setAlerts(alertsData || []);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }
  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const result = await api.search(searchQuery);
      setSearchResult(result);
    } catch (err) {
      console.error("Search failed:", err);
    } finally {
      setSearching(false);
    }
  }
  async function loadAlertRules() {
    try {
      const data = await api.getAlertRules();
      setAlertRules(data || []);
    } catch (err) {
      console.error('Failed to load alert rules:', err);
    }
  }

  async function handleCreateAlertRule(e: FormEvent) {
    e.preventDefault();
    if (!newRuleName || !newRuleService) return;
    setCreatingRule(true);
    try {
      await api.createAlertRule({
        name: newRuleName,
        condition: { type: 'anomaly' },
        service: newRuleService,
        notify_url: newRuleWebhook || '',
      });
      setNewRuleName('');
      setNewRuleService('');
      setNewRuleWebhook('');
      setShowCreateRule(false);
      await loadAlertRules();
    } catch (err) {
      console.error('Failed to create alert rule:', err);
    } finally {
      setCreatingRule(false);
    }
  }
  // Transform stats for the chart
  const chartData =
    stats?.volume_by_hour?.reduce((acc: any[], row: any) => {
      const hour = new Date(row.hour).toLocaleTimeString([], {
        hour: "2-digit",
      });
      const existing = acc.find((item) => item.hour === hour);
      if (existing) {
        existing[row.level] = (existing[row.level] || 0) + parseInt(row.count);
      } else {
        acc.push({ hour, [row.level]: parseInt(row.count) });
      }
      return acc;
    }, []) || [];
  const levelColors: Record<string, string> = {
    ERROR: "bg-red-100 text-red-800",
    WARN: "bg-yellow-100 text-yellow-800",
    INFO: "bg-blue-100 text-blue-800",
    DEBUG: "bg-gray-100 text-gray-600",
  };
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Log Drain</h1>
            <p className="text-sm text-gray-500">AI-powered log analysis</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              Live
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <Activity size={14} />
              Total logs (24h)
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {stats?.volume_by_hour?.reduce((sum: number, row: any) => 
                sum + parseInt(row.count || 0), 0) || logs.length}
            </div>
          </div>
          <div 
            className="bg-white rounded-lg border border-gray-200 p-4 cursor-pointer hover:border-red-300 hover:bg-red-50 transition-colors"
            onClick={scrollToAnomalies}
            title="Click to see anomalies"
          >
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <AlertTriangle size={14} />
              Anomalies (24h)
            </div>
            <div className="text-2xl font-semibold text-red-600">
              {stats?.anomaly_count_24h || 0}
            </div>
            <div className="text-xs text-gray-400 mt-1">Click to view</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              <Server size={14} />
              Services
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {services.length}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
              Error rate
            </div>
            <div className="text-2xl font-semibold text-gray-900">
              {stats?.error_rates?.[0]?.error_rate_pct || 0}%
            </div>
          </div>
        </div>
        {/* Volume Chart */}
        {chartData.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-sm font-medium text-gray-700 mb-4">
              Log volume (last 24h)
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="ERROR" fill="#ef4444" stackId="a" />
                <Bar dataKey="WARN" fill="#f59e0b" stackId="a" />
                <Bar dataKey="INFO" fill="#3b82f6" stackId="a" />
                <Bar dataKey="DEBUG" fill="#d1d5db" stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* AI Semantic Search */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-medium text-gray-700 mb-4 flex items-center gap-2">
            <Search size={14} />
            AI Semantic Search
          </h2>
          <form onSubmit={handleSearch} className="flex gap-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ask in plain English: show me database errors from last night..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm
focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex flex-col items-end gap-1">
              <button
                type="submit"
                disabled={searching}
                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {searching ? "Searching..." : "Search"}
              </button>
              {searching && (
                <span className="text-xs text-gray-400 italic">
                  Using free AI model —  this may take a few seconds
                </span>
              )}
            </div>
          </form>
          {searchResult && (
            <div className="mt-4 space-y-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm font-medium text-blue-900 mb-1">
                  AI Answer
                </p>
                <div className="text-sm text-blue-800 [&>ul]:list-disc [&>ul]:pl-4 [&>ul]:space-y-1 [&>p]:mb-2 [&>ol]:list-decimal [&>ol]:pl-4 [&>hr]:hidden [&>h2]:text-base [&>h2]:font-bold [&>h2]:mt-3 [&>h3]:text-sm [&>h3]:font-bold [&>h3]:mt-2">
                  <ReactMarkdown>{searchResult.answer}</ReactMarkdown>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium">
                  Relevant log entries ({searchResult.logs?.length})
                </p>
                {searchResult.logs?.map((log: any) => (
                  <LogRow key={log.id} log={log} levelColors={levelColors} scrollToAnomalies={scrollToAnomalies} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              <AlertTriangle size={14} />
              Alert Rules
            </h2>
            <button
              onClick={() => setShowCreateRule(!showCreateRule)}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {showCreateRule ? 'Cancel' : '+ New Rule'}
            </button>
          </div>

          {showCreateRule && (
            <form onSubmit={handleCreateAlertRule} className="mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <div>
                <label className="text-xs text-gray-600 font-medium">Rule Name</label>
                <input
                  type="text"
                  value={newRuleName}
                  onChange={e => setNewRuleName(e.target.value)}
                  placeholder="e.g. Payment API Anomaly Alert"
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 font-medium">Service</label>
                <select
                  value={newRuleService}
                  onChange={e => setNewRuleService(e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select a service</option>
                  {services.map((s: any) => (
                    <option key={s.service} value={s.service}>{s.service}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 font-medium">
                  Webhook URL (optional — for Slack/PagerDuty notifications)
                </label>
                <input
                  type="url"
                  value={newRuleWebhook}
                  onChange={e => setNewRuleWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/..."
                  className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={creatingRule}
                className="w-full py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {creatingRule ? 'Creating...' : 'Create Alert Rule'}
              </button>
            </form>
          )}

          {alertRules.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              No alert rules yet. Create one to get notified when anomalies are detected.
            </p>
          ) : (
            <div className="space-y-2">
              {alertRules.map((rule: any) => (
                <div key={rule.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{rule.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Service: {rule.service || 'All'} · 
                      Type: {rule.condition?.type} · 
                      {rule.notify_url ? ' Webhook configured' : ' No webhook'}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    rule.active 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {rule.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Log Stream */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Log stream</h2>
            <div className="flex gap-2">
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                <option value="">All levels</option>
                <option value="ERROR">ERROR</option>
                <option value="WARN">WARN</option>
                <option value="INFO">INFO</option>
                <option value="DEBUG">DEBUG</option>
              </select>
              <select
                value={serviceFilter}
                onChange={(e) => setServiceFilter(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1"
              >
                <option value="">All services</option>
                {services.map((s: any) => (
                  <option key={s.service} value={s.service}>
                    {s.service}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1 font-mono text-xs max-h-96 overflow-y-auto">
            {logs.map((log) => (
              <LogRow key={log.id} log={log} levelColors={levelColors} scrollToAnomalies={scrollToAnomalies} />
            ))}
            {logs.length === 0 && (
              <p className="text-gray-400 text-center py-8">
                No logs found. Send your first log to POST /api/v1/logs
              </p>
            )}
          </div>
        </div>
        {alerts.length > 0 && (
          <div ref={anomaliesRef} className="bg-white rounded-lg border border-red-200 p-6">
            <h2 className="text-sm font-medium text-red-700 mb-4 flex items-center gap-2">
              <AlertTriangle size={14} />
              Recent Anomaly Alerts ({alerts.length})
            </h2>
            <div className="space-y-2">
              {alerts.map((alert: any) => (
                <div key={alert.id} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                  <span className="text-red-500 text-xs font-medium shrink-0">
                    {new Date(alert.fired_at).toLocaleTimeString()}
                  </span>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-red-800">
                      {alert.rule_name || 'Anomaly Alert'}
                    </span>
                    <p className="text-xs text-red-600 mt-0.5">
                      Service: {alert.details?.service} — 
                      {alert.details?.anomaly_count} anomalous logs detected
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
function LogRow({
  log,
  levelColors,
  scrollToAnomalies,
}: {
  log: any;
  levelColors: Record<string, string>;
  scrollToAnomalies: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-2 rounded ${log.is_anomaly ? "bg-red-50 border border-red-200" : "hover:bg-gray-50"}`}
    >
      <span
        className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium
${levelColors[log.level] || "bg-gray-100 text-gray-600"}`}
      >
        {log.level}
      </span>
      <span className="text-gray-400 shrink-0">
        {new Date(log.timestamp).toLocaleTimeString()}
      </span>
      <span className="text-blue-600 shrink-0">{log.service}</span>
      <span className="text-gray-700 flex-1 break-all">{log.message}</span>
      {log.is_anomaly && (
        <span 
          className="shrink-0 text-red-500 text-xs font-medium cursor-pointer hover:underline"
          onClick={scrollToAnomalies}
          title="Click to see anomaly alerts"
        >
          ⚠ anomaly
        </span>
      )}
    </div>
  );
}
