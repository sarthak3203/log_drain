/*
 * Reproducible local ingestion benchmark.
 *
 * Run: npm run load-test
 * Optional: LOAD_TEST_BASE_URL=http://localhost:3000
 *
 * This script intentionally creates an isolated user, project, and one-time
 * project API key through the live API. It never prints the key. It uses ten
 * connections at 5 req/s for 30 seconds: 5 req/s is below the configured
 * 300-request/minute ingestion limiter. After the run it waits 15 seconds,
 * counts this run's persisted rows directly in Postgres, then times one live
 * keyword-mode structured search request.
 */
require('dotenv/config');
const autocannon = require('autocannon');
const { Client } = require('pg');
const { performance } = require('node:perf_hooks');

const baseUrl = process.env.LOAD_TEST_BASE_URL || 'http://localhost:3000';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to verify persisted rows.');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function post(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

function runAutocannon(options) {
  return new Promise((resolve, reject) => {
    autocannon(options, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const registration = await post('/api/v1/auth/register', {
    email: `loadtest.${suffix}@example.com`,
    password: 'LoadTestPassword123!',
    name: 'Autocannon Load Test',
  });
  const project = await post('/api/v1/projects', { name: `Autocannon ${suffix}` }, {
    authorization: `Bearer ${registration.token}`,
  });
  if (!project.api_key || !project.project?.id) throw new Error('Live project endpoint did not return a project and API key.');
  console.log(`Created real test project: ${project.project.id}`);

  const runId = `autocannon-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const payload = JSON.stringify({
    level: 'INFO',
    message: `Load-test event for ${runId}`,
    service: 'load-test',
    metadata: { load_test_run_id: runId },
  });
  const result = await runAutocannon({
    url: `${baseUrl}/api/v1/logs`,
    method: 'POST',
    connections: 10,
    duration: 30,
    overallRate: 5,
    headers: {
      authorization: `Bearer ${project.api_key}`,
      'content-type': 'application/json',
    },
    body: payload,
  });

  // These are values returned by autocannon, with no rounding or estimation.
  console.log('Autocannon final result fields:');
  console.log(JSON.stringify({
    run_id: runId,
    requests_per_second_average: result.requests.average,
    average_latency_ms: result.latency.average,
    total_requests_completed: result.requests.total,
    status_2xx: result['2xx'],
    status_non_2xx: result.non2xx,
    errors: result.errors,
    timeouts: result.timeouts,
  }, null, 2));

  await sleep(15_000);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const persisted = await client.query(
    "SELECT COUNT(*)::int AS count FROM logs WHERE project_id = $1 AND metadata->>'load_test_run_id' = $2",
    [project.project.id, runId],
  );
  await client.end();
  console.log(`Persisted rows after 15 seconds: ${persisted.rows[0].count}`);

  const searchStart = performance.now();
  const searchResponse = await fetch(
    `${baseUrl}/api/v1/search/structured?q=${encodeURIComponent('Load-test event')}&mode=keyword`,
    { headers: { authorization: `Bearer ${project.api_key}` } },
  );
  const searchBody = await searchResponse.json();
  const searchLatencyMs = performance.now() - searchStart;
  console.log('Single structured-search result:');
  console.log(JSON.stringify({
    status: searchResponse.status,
    response_time_ms: searchLatencyMs,
    logs_searched: searchBody.logs_searched,
    returned_logs: Array.isArray(searchBody.logs) ? searchBody.logs.length : undefined,
    error: searchBody.error,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
