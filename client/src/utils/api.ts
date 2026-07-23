import axios from "axios";
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/api/v1";
// Read API key from localStorage (set on first login)
function getAuthHeader() {
  const key = localStorage.getItem("api_key");
  return key ? { Authorization: `Bearer ${key}` } : {};
}
export const api = {
  async getLogs(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    const { data } = await axios.get(`${BASE_URL}/logs?${qs}`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async search(query: string, params: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q: query, ...params }).toString();
    const { data } = await axios.get(`${BASE_URL}/search?${qs}`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async structuredSearch(query: string, params: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q: query, ...params }).toString();
    const { data } = await axios.get(`${BASE_URL}/search/structured?${qs}`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async agentQuery(question: string) {
    const { data } = await axios.post(
      `${BASE_URL}/agent/query`,
      { question },
      { headers: getAuthHeader() }
    );
    return data;
  },
  async getStats(hours = 24) {
    const { data } = await axios.get(`${BASE_URL}/stats?hours=${hours}`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async getServices() {
    const { data } = await axios.get(`${BASE_URL}/services`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async getAlerts() {
    const { data } = await axios.get(`${BASE_URL}/alerts`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async getAlertRules() {
    const { data } = await axios.get(`${BASE_URL}/alert-rules`, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async createAlertRule(rule: {
    name: string;
    condition: object;
    service: string;
    notify_url: string;
  }) {
    const { data } = await axios.post(`${BASE_URL}/alert-rules`, rule, {
      headers: getAuthHeader(),
    });
    return data;
  },
  async createProject(name: string) {
    const { data } = await axios.post(`${BASE_URL}/projects`, { name });
    return data;
  },
};
