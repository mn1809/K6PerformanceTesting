/**
 * ===========================================================================
 *  Miles LMS — Multi-Endpoint Load Test
 * ===========================================================================
 *  Flow:
 *    1. setup()    → POST /studentLogin ONCE → get token
 *    2. default()  → run EVERY enabled TEST_CASE once per iteration, with token
 *
 *  HOW TO ADD A NEW CASE
 *    Just append an object to the TEST_CASES array below. Five fields:
 *      • name     : human-readable label (also used as a metric tag)
 *      • method   : 'GET' | 'POST' | 'PUT' | 'DELETE'
 *      • path     : everything after BASE_URL (e.g. '/student/profile')
 *      • payload  : JSON string for POST/PUT, or null for GET
 *      • enabled  : true / false — toggle without deleting the case
 *
 *  HOW TO RUN
 *    Smoke (1 VU, 1 iteration, full response logging):
 *      k6 run -e TEST_MODE=smoke scripts/stress_LMS.js
 *    Load:
 *      k6 run scripts/stress_LMS.js
 * ============================================================================
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ============================================================================
// CONFIG
// ============================================================================
const BASE_URL        = __ENV.BASE_URL        || 'http://miles-lms-alb-2027281609.ap-south-1.elb.amazonaws.com';
const REGISTRATION_ID = __ENV.REGISTRATION_ID || 'chakradhar.gollapudi@mileseducation.com';
const PASSWORD        = __ENV.PASSWORD        || 'chakri1234';
const LOGIN_PATH      = '/studentLogin';

const TEST_MODE = (__ENV.TEST_MODE || 'load').toLowerCase();
const VERBOSE   = __ENV.VERBOSE !== undefined
                    ? __ENV.VERBOSE === '1'
                    : TEST_MODE === 'smoke';

// ============================================================================
// TEST CASES — add new ones here. Order matters: cases run top to bottom.
// ============================================================================
const TEST_CASES = [
  // {
  //   name:    'Dashboard',
  //   method:  'GET',
  //   path:    '/dashboard',
  //   payload: null,
  //   enabled: true,
  // },
  {
    name:    'StudentDetails',
    method:  'POST',
    path:    '/student/details',
    payload: '{}',
    enabled: true,
  },
  // Case 3 — add like this:
  // {
  //   name:    'StudentProfile',
  //   method:  'GET',
  //   path:    '/student/profile',
  //   payload: null,
  //   enabled: true,
  // },
  //
  // Case 4 — POST with a real body:
  // {
  //   name:    'SubmitQuiz',
  //   method:  'POST',
  //   path:    '/quiz/submit',
  //   payload: JSON.stringify({ quiz_id: 123, answers: [1, 2, 3] }),
  //   enabled: true,
  // },
];

// ============================================================================
// CUSTOM METRICS — one Rate + one Trend, sliced per case via tags
// ============================================================================
const caseSuccessRate = new Rate('case_success_rate');
const caseDuration    = new Trend('case_duration_ms', true);

// ============================================================================
// SCENARIOS
// ============================================================================
const SMOKE_SCENARIO = {
  smoke: {
    executor:    'shared-iterations',
    vus:         1,
    iterations:  1,
    maxDuration: '30s',
  },
};

const LOAD_SCENARIO = {
  multi_endpoint_load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '5m',  target: 40  },  // 🔼 Warm up
        { duration: '10m', target: 80  },  // 🔼 Mid load
        { duration: '10m', target: 100 },  // 🔼 Peak stress
        { duration: '10m', target: 100 },  // ➡️ Hold peak
        { duration: '5m',  target: 10   },  // 🔽 Cool down
    ],
    gracefulRampDown: '60s',
  },
};

export const options = {
  scenarios: TEST_MODE === 'smoke' ? SMOKE_SCENARIO : LOAD_SCENARIO,

  thresholds: TEST_MODE === 'smoke' ? {} : {
    'http_req_failed':     ['rate<0.05'],
    'http_req_duration':   ['p(95)<3000', 'p(99)<8000'],
    'case_success_rate':   ['rate>0.95'],
  },

  tags: {
    test_name: `multi-endpoint-${TEST_MODE}`,
    env: __ENV.ENV || 'staging',
  },
};

// ============================================================================
// HELPERS
// ============================================================================

// IMPORTANT: this API takes the JWT raw — no "Bearer" prefix
// (confirmed via Postman screenshot).
function authHeaders(token) {
  return {
    'Authorization': token,
    'Content-Type':  'application/json',
    'Accept':        'application/json, text/plain, */*',
  };
}

function logCaseResult(caseNum, testCase, res, passed) {
  const divider = '─'.repeat(70);
  const verdict = passed ? '✅ PASSED' : '❌ FAILED';
  console.log(`\n${divider}`);
  console.log(`▶ Case ${caseNum}: ${testCase.name}  →  ${testCase.method} ${BASE_URL}${testCase.path}`);
  if (testCase.payload) {
    console.log(`  Payload  : ${testCase.payload}`);
  }
  console.log(`  Status   : ${res.status} ${res.status_text || ''}`);
  console.log(`  Duration : ${res.timings.duration.toFixed(0)} ms`);
  console.log(`  Result   : ${verdict}`);

  const body = (res.body || '').toString();
  if (body.length === 0)        console.log(`  Body     : (empty)`);
  else if (body.length <= 600)  console.log(`  Body     : ${body}`);
  else                          console.log(`  Body     : ${body.slice(0, 600)} ... (${body.length} chars total)`);
  console.log(`${divider}`);
}

// ============================================================================
// CASE RUNNER — handles one test case
// ============================================================================
function runCase(caseNum, testCase, token) {
  const params = {
    headers: authHeaders(token),
    tags:    { case: testCase.name, endpoint: testCase.name },
  };

  let res;
  const url = `${BASE_URL}${testCase.path}`;

  switch (testCase.method.toUpperCase()) {
    case 'GET':
      res = http.get(url, params);
      break;
    case 'POST':
      res = http.post(url, testCase.payload || '{}', params);
      break;
    case 'PUT':
      res = http.put(url, testCase.payload || '{}', params);
      break;
    case 'DELETE':
      res = http.del(url, testCase.payload || null, params);
      break;
    default:
      console.error(`Unsupported method: ${testCase.method}`);
      return false;
  }

  // Validation — tag the check so it shows up per-case in the summary
  const passed = check(res, {
    'status is 200':     (r) => r.status === 200,
    'response has body': (r) => r.body && r.body.length > 0,
  }, { case: testCase.name });

  // Record per-case metrics
  caseSuccessRate.add(passed, { case: testCase.name });
  caseDuration.add(res.timings.duration, { case: testCase.name });

  // Log every case in smoke/verbose mode, otherwise only first 3 iters + failures
  if (VERBOSE || !passed || __ITER < 3) {
    logCaseResult(caseNum, testCase, res, passed);
  }

  return passed;
}

// ============================================================================
// SETUP — login once, return token
// ============================================================================
export function setup() {
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('SETUP — logging in to obtain auth token (runs once)');
  console.log('══════════════════════════════════════════════════════════════');

  const loginRes = http.post(
    `${BASE_URL}${LOGIN_PATH}`,
    JSON.stringify({ registration_id: REGISTRATION_ID, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  console.log(`Login URL      : POST ${BASE_URL}${LOGIN_PATH}`);
  console.log(`Login status   : ${loginRes.status}`);
  console.log(`Login duration : ${loginRes.timings.duration.toFixed(0)} ms`);

  if (loginRes.status !== 200) {
    console.error(`Body: ${(loginRes.body || '').slice(0, 500)}`);
    throw new Error(`Login failed in setup — status ${loginRes.status}`);
  }

  // Token lives in data[] array, in whichever element has a `token` key
  let token = null;
  try {
    const body = loginRes.json();
    if (Array.isArray(body?.data)) {
      const entry = body.data.find(item => item && item.token);
      token = entry?.token || null;
    }
    if (!token) {
      token = body?.token || body?.data?.token || null;
    }
  } catch (e) {
    console.error(`JSON parse failed: ${e.message}`);
  }

  if (!token) {
    console.error('No token found in login response. Full body:');
    console.error((loginRes.body || '').slice(0, 1500));
    throw new Error('Token extraction failed');
  }

  console.log(`✅ Token obtained: ${String(token).slice(0, 30)}...`);
  console.log('══════════════════════════════════════════════════════════════\n');

  return { token };
}

// ============================================================================
// DEFAULT — runs every test case once per VU iteration
// ============================================================================
export default function (data) {
  const enabledCases = TEST_CASES.filter(c => c.enabled);

  let passed = 0;
  let failed = 0;
  let caseNum = 0;

  for (const testCase of enabledCases) {
    caseNum++;
    const ok = runCase(caseNum, testCase, data.token);
    if (ok) passed++; else failed++;

    // Small breathing room between cases (only outside smoke)
    if (TEST_MODE !== 'smoke') sleep(0.5);
  }

  // Per-iteration summary line
  console.log(`\n📊 Iteration done | VU=${__VU} ITER=${__ITER} | ✅ ${passed}  ❌ ${failed}  📋 ${enabledCases.length}\n`);

  // Think time between iterations (skip in smoke)
  if (TEST_MODE !== 'smoke') {
    sleep(Math.random() * 2 + 1);   // 1–3s
  }
}

// ============================================================================
// SUMMARY
// ============================================================================
export function handleSummary(data) {
  const m = data.metrics;

  const vusMax     = m.vus_max?.values?.max                       ?? 'N/A';
  const iterations = m.iterations?.values?.count                  ?? 'N/A';
  const httpReqs   = m.http_reqs?.values?.count                   ?? 'N/A';
  const rps        = m.http_reqs?.values?.rate?.toFixed(2)        ?? 'N/A';
  const failRate   = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  const caseRate   = ((m.case_success_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const avg        = m.http_req_duration?.values?.avg?.toFixed(0)       ?? 'N/A';
  const p95        = m.http_req_duration?.values?.['p(95)']?.toFixed(0) ?? 'N/A';
  const p99        = m.http_req_duration?.values?.['p(99)']?.toFixed(0) ?? 'N/A';

  // Per-case breakdown
  const caseLines = TEST_CASES
    .filter(c => c.enabled)
    .map(c => `   • ${c.name.padEnd(20)} : ${c.method} ${c.path}`)
    .join('\n');

  const banner = `
══════════════ MULTI-ENDPOINT LOAD TEST — SUMMARY ══════════════
 Mode             : ${TEST_MODE.toUpperCase()}
 Login (once)     : POST ${BASE_URL}${LOGIN_PATH}
 Peak VUs         : ${vusMax}
 Iterations       : ${iterations}    (each runs all enabled cases)
 Total requests   : ${httpReqs}   (${rps} req/s avg)

 Enabled cases:
${caseLines}

 Response time
   • avg          : ${avg} ms
   • p95          : ${p95} ms
   • p99          : ${p99} ms

 Case success     : ${caseRate} %
 HTTP failures    : ${failRate} %

 NOTE: For per-case metrics (e.g. how slow each endpoint was),
       check the http_req_duration{case:CaseName} entries above.
═════════════════════════════════════════════════════════════════
`;

  return {
    'stdout':           textSummary(data, { indent: ' ', enableColors: true }) + banner,
    'k6-summary.json':  JSON.stringify(data, null, 2),
  };
}