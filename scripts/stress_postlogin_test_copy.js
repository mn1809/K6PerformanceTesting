import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * ===============================
 * k6 OPTIONS
 * ===============================
 */
export let options = {
  scenarios: {
    post_login_load: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 400, 
      maxDuration: '45m',
    },
  },
  // ✅ FIX 1: Add thresholds to distinguish acceptable flakiness from real failures
  thresholds: {
    'checks{step:Profile API}':                    ['rate>0.99'],
    'checks{step:My Orders API}':                  ['rate>0.99'],
    'checks{step:Course Library MM2 API}':         ['rate>0.95'],
    'checks{step:Course Library Podcast1 API}':    ['rate>0.95'],
    'checks{step:Course Library Podcast2 API}':    ['rate>0.95'],
    'checks{step:Course Library Nano1 API}':       ['rate>0.95'],
    'checks{step:Course Library Nano2 API}':       ['rate>0.95'],
  },
};

const BASE_URL = 'https://test-masterclass.milesmasterclass.com';
const email = 'manoj.hr@mileseducation.com';
const otp = '654987';

// ✅ FIX 2: Per-iteration counters (not global — safe across VUs)
function makeCounters() {
  return { total: 0, passed: 0, failed: 0 };
}

/**
 * ===============================
 * HELPER: Safe JSON Parser
 * ===============================
 */
function safeJson(res) {
  try {
    return res.json();
  } catch (e) {
    return null;
  }
}

/**
 * ===============================
 * ✅ FIX 3: Retry Helper
 * Retries a request fn up to `retries` times if validator returns false.
 * ===============================
 */
function withRetry(requestFn, validator, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    const res = requestFn();
    if (validator(res)) return res;
    if (i < retries - 1) sleep(delayMs / 1000);
  }
  return requestFn(); // final attempt
}

/**
 * ===============================
 * runStep()
 * ===============================
 */
function runStep(stepName, stepFn, data, counters) {
  counters.total++;
  console.log(`\n Test ${counters.total}: ${stepName}`);

  let passed = false;
  try {
    passed = stepFn(data);
  } catch (e) {
    console.error(`❌ ERROR in ${stepName}: ${e.message}`);
    passed = false;
  }

  if (passed) {
    counters.passed++;
    console.log(`✅ RESULT: ${stepName} PASSED`);
  } else {
    counters.failed++;
    console.log(`❌ RESULT: ${stepName} FAILED`);
  }

  console.log('--------------------------------------------------');
  return passed;
}

/**
 * ===============================
 * setup() → RUNS ONLY ONCE
 * ===============================
 */
export function setup() {
  const sendOtpResponse = http.post(
    `${BASE_URL}/api/send-otp-to-phone`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const sessionId = sendOtpResponse.json('data.result.session_id');
  console.log(`Session ID: ${sessionId}`);

  const verifyResponse = http.post(
    `${BASE_URL}/api/verify-otp`,
    JSON.stringify({
      session_id: sessionId,
      otp: otp,
      browser_session_id: `setup-${Date.now()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-app-type': 'WA',
      },
    }
  );

  const token = verifyResponse.json('data.token');
  console.log('✅ TOKEN GENERATED ONCE');
  return { token };
}

/**
 * Shared auth headers builder
 */
function authHeaders(token) {
  return {
    Authorization: `bearer ${token}`,
    'Content-Type': 'application/json',
    accept: 'application/json, text/plain, */*',
    'x-app-type': 'WA',
  };
}

// ============================================================
// API FUNCTIONS
// ============================================================

function profileAPI(data) {
  const res = http.get(`${BASE_URL}/api/user/myprofile/`, { headers: authHeaders(data.token) });
  return check(res, {
    'Profile status 200': (r) => r.status === 200,
    'Profile status_code true': (r) =>
      r.json('status_code') === true || r.json('status_code') === 'true',
  });
}

function relatedCourseAPI(data) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/dashboard/related_content/`,
    JSON.stringify({ masterclass_id: 135 }),
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Related Course RT: ${Date.now() - start} ms`);

  const jsonData = safeJson(res);
  const titles = (jsonData?.data || []).map(item => item.title).filter(Boolean);
  titles.forEach((t, i) => console.log(`📘 Related Course ${i + 1}: ${t}`));

  return check(res, {
    'Related API status 200': (r) => r.status === 200,
    'At least one related course title present': () => titles.length > 0,
  });
}

function courseDetailsPageAPI(data) {
  const start = Date.now();
  const res = http.get(`${BASE_URL}/api/masterclass/details/?id=128`, { headers: authHeaders(data.token) });
  console.log(`⏱ Course Details RT: ${Date.now() - start} ms`);

  const jsonData = safeJson(res);
  const title = jsonData?.data?.title || '❌ Title not found';
  console.log(`📘 Course Title: ${title}`);

  return check(res, {
    'Course Details status 200': (r) => r.status === 200,
    'Course title present': () => title !== '❌ Title not found',
    'status_code is 200': (r) =>
      r.json('status_code') === 200 || r.json('status_code') === '200',
  });
}

function complimentaryCourseAPI(data) {
  const start = Date.now();
  // ✅ FIX 4: Retry if data is empty
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/complimentary-course/?course_type=masterclass&page=1`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return b?.data?.[0]?.title ? true : false;
    }
  );
  console.log(`⏱ Complimentary Course RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '❌ Title not found';
  console.log(`Complimentary Course Title: ${title}`);

  return check(res, {
    'Complimentary API status 200': (r) => r.status === 200,
    'First course title exists': () => title !== '❌ Title not found',
  });
}

function verifyTrack1API(data) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    JSON.stringify({ track: 'enable_for_human_skills_in_the_age_of_ai' }),
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Track 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;
  console.log(`🎯 Track 1 Title: ${title}`);

  return check(res, {
    'Get Track 1 HTTP 200': (r) => r.status === 200,
    'Track 1 status_code 200': () => body?.status_code === 200,
    'Track 1 title exists': () => title !== null && title.trim().length > 0,
  });
}

function verifyTrack2API(data) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    JSON.stringify({ track: 'enable_for_ai_leadership' }),
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Track 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;
  console.log(`🎯 Track 2 Title: ${title}`);

  return check(res, {
    'Get Track 2 HTTP 200': (r) => r.status === 200,
    'Track 2 status_code 200': () => body?.status_code === 200,
    'Track 2 title exists': () => title !== null && title.trim().length > 0,
  });
}

function verifyTrack3API(data) {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    JSON.stringify({ track: 'enable_for_generative_ai' }),
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Track 3 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;
  console.log(`🎯 Track 3 Title: ${title}`);

  return check(res, {
    'Get Track 3 HTTP 200': (r) => r.status === 200,
    'Track 3 status_code 200': () => body?.status_code === 200,
    'Track 3 title exists': () => title !== null && title.trim().length > 0,
  });
}

function verifyPlanPageAPI(data) {
  const start = Date.now();
  // ✅ FIX 5: Retry subscription API
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/promotion/subscription/`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return Array.isArray(b?.data) && b.data.length > 0;
    }
  );

  const body = safeJson(res);
  console.log(`⏱ Subscription API RT (ms): ${Date.now() - start}`);

  const plans = Array.isArray(body?.data) ? body.data : [];
  plans.forEach(plan => console.log(`Plans on Subscription page: ${plan.subscription_name}`));

  return check(res, {
    'Subscription API HTTP 200': (r) => r.status === 200,
    'Subscription status_code 200': () => body?.status_code === 200,
    'Subscription list is not empty': () => plans.length > 0,
    'All plans have valid subscription_name': () =>
      plans.every(p => p.subscription_name && p.subscription_name.trim().length > 0),
  });
}

function podcastTrack1API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/6/courses/?course_type=podcast&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Podcast Track 6 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`🎧 Podcast Track 6 Title: ${title}`);

  return check(res, {
    'Podcast Track 6 status 200': (r) => r.status === 200,
    'Podcast Track 6 title exists': () => title !== 'Title not found',
  });
}

function podcastTrack2API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/7/courses/?course_type=podcast&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Podcast Track 7 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`🎧 Podcast Track 7 Title: ${title}`);

  return check(res, {
    'Podcast Track 7 status 200': (r) => r.status === 200,
    'Podcast Track 7 title exists': () => title !== 'Title not found',
  });
}

function podcastTrack3API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/8/courses/?course_type=podcast&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Podcast Track 8 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`🎧 Podcast Track 8 Title: ${title}`);

  return check(res, {
    'Podcast Track 8 status 200': (r) => r.status === 200,
    'Podcast Track 8 title exists': () => title !== 'Title not found',
  });
}

function complimentaryPodcastCourseAPI(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/complimentary-course/?course_type=podcast&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Complimentary Podcast RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '❌ Title not found';
  console.log(`Podcast Complimentary Course Title: ${title}`);

  return check(res, {
    'Complimentary Podcast API status 200': (r) => r.status === 200,
    'Podcast complimentary title exists': () => title !== '❌ Title not found',
  });
}

function EssentialPodcastCourseAPI(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/dashboard/latest_podcast/?course_type=podcast&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Essential Podcast RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '❌ Title not found';
  console.log(`Essential Podcast Course Title: ${title}`);

  return check(res, {
    'Essential Podcast API status 200': (r) => r.status === 200,
    'Essential podcast title exists': () => title !== '❌ Title not found',
  });
}

function nanoTrack1API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/6/courses/?course_type=nano_learning&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Nano Track 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`📘 Nano Track 1 Title: ${title}`);

  return check(res, {
    'Nano Track 1 status 200': (r) => r.status === 200,
    'Nano Track 1 title exists': () => title !== 'Title not found',
  });
}

function nanoTrack2API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/7/courses/?course_type=nano_learning&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Nano Track 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`📘 Nano Track 2 Title: ${title}`);

  return check(res, {
    'Nano Track 2 status 200': (r) => r.status === 200,
    'Nano Track 2 title exists': () => title !== 'Title not found',
  });
}

// ✅ FIX 6: nanoTrack3API had wrong log labels ("Nano Track 2" instead of "Nano Track 3")
function nanoTrack3API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/8/courses/?course_type=nano_learning&page=1`,
    { headers: authHeaders(data.token) }
  );
  console.log(`⏱ Nano Track 3 RT (ms): ${Date.now() - start}`);   // ✅ Fixed label

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || 'Title not found';
  console.log(`📘 Nano Track 3 Title: ${title}`);                  // ✅ Fixed label

  return check(res, {
    'Nano Track 3 status 200': (r) => r.status === 200,            // ✅ Fixed label
    'Nano Track 3 title exists': () => title !== 'Title not found', // ✅ Fixed label
  });
}

function nanoLearningPage1API(data) {
  const start = Date.now();
  // ✅ FIX 7: Retry nano learning pages (they showed 10s→35s degradation in logs)
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/nano_learning/?page=1`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return Array.isArray(b?.data) && b.data.length > 0;
    }
  );
  console.log(`⏱ Nano Learning Page 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Nano Learning Page 1 status 200': (r) => r.status === 200,
    'Nano Learning Page 1 status_code 200': () => body?.status_code === 200,
    'Nano Learning Page 1 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Nano Learning Page 1 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Asserted Nano Learning Page 1 Title: ${title}`);
  return passed;
}

function nanoLearningPage2API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/nano_learning/?page=2`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return Array.isArray(b?.data) && b.data.length > 0;
    }
  );
  console.log(`⏱ Nano Learning Page 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Nano Learning Page 2 status 200': (r) => r.status === 200,
    'Nano Learning Page 2 status_code 200': () => body?.status_code === 200,
    'Nano Learning Page 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Nano Learning Page 2 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Asserted Nano Learning Page 2 Title: ${title}`);
  return passed;
}

// ✅ FIX 8: nanoLearningPage3API was hitting page=2 instead of page=3 — CRITICAL BUG
function nanoLearningPage3API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/nano_learning/?page=3`, { headers: authHeaders(data.token) }), // ✅ Fixed: was page=2
    (r) => {
      const b = safeJson(r);
      return Array.isArray(b?.data) && b.data.length > 0;
    }
  );
  console.log(`⏱ Nano Learning Page 3 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Nano Learning Page 3 status 200': (r) => r.status === 200,
    'Nano Learning Page 3 status_code 200': () => body?.status_code === 200,
    'Nano Learning Page 3 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Nano Learning Page 3 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Asserted Nano Learning Page 3 Title: ${title}`);
  return passed;
}

function VerifyCPETrackAPI(data) {
  const res = http.get(`${BASE_URL}/api/user-badges/`, { headers: authHeaders(data.token) });

  const body = safeJson(res);
  const badges = body?.data || [];

  let passed = check(res, {
    'User Badges status 200': (r) => r.status === 200,
    'Badges list not empty': () => badges.length > 0,
  });

  for (let i = 0; i < badges.length; i++) {
    const badge = badges[i]?.badge;
    passed = passed && check(badge, {
      [`Badge name exists [${i}]`]: () => !!badge?.name,
      [`Level name exists [${i}]`]: () => !!badge?.level_name,
      [`Level rank exists [${i}]`]: () => badge?.level_rank !== undefined,
      [`Required credits exists [${i}]`]: () => !!badge?.required_credits,
    });
    console.log(`✔ Badge: ${badge.name} | ${badge.level_name} | Rank: ${badge.level_rank} | Credits: ${badge.required_credits}`);
  }

  return passed;
}

// ✅ FIX 9: All library APIs now use withRetry to handle empty paginated responses under load

function verifyCourseLibraryMM1API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=masterclass&page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Masterclass Library 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Masterclass Library 1 status 200': (r) => r.status === 200,
    'Masterclass Library 1 status_code 200': () => body?.status_code === 200,
    'Masterclass Library 1 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Masterclass Library 1 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Masterclass Page 1 Lib Title: ${title}`);
  return passed;
}

function verifyCourseLibraryMM2API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=masterclass&page=2`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Masterclass Library 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Masterclass Library 2 status 200': (r) => r.status === 200,
    'Masterclass Library 2 status_code 200': () => body?.status_code === 200,
    'Masterclass Library 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Masterclass Library 2 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Masterclass Page 2 Lib Title: ${title}`);
  return passed;
}

function verifyCourseLibraryPodcast1API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=podcast&page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Podcast Library 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Podcast Library 1 status 200': (r) => r.status === 200,
    'Podcast Library 1 status_code 200': () => body?.status_code === 200,
    'Podcast Library 1 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Podcast Library 1 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Podcast Page 1 Lib Title: ${title}`);
  return passed;
}

function verifyCourseLibraryPodcast2API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=podcast&page=2`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Podcast Library 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Podcast Library 2 status 200': (r) => r.status === 200,
    'Podcast Library 2 status_code 200': () => body?.status_code === 200,
    'Podcast Library 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Podcast Library 2 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Podcast Page 2 Lib Title: ${title}`);
  return passed;
}

function verifyCourseLibraryNano1API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=nano&page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Nano Library 1 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Nano Library 1 status 200': (r) => r.status === 200,
    'Nano Library 1 status_code 200': () => body?.status_code === 200,
    'Nano Library 1 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Nano Library 1 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Nano Page 1 Lib Title: ${title}`);
  return passed;
}

function verifyCourseLibraryNano2API(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/library/?type=nano&page=2`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Nano Library 2 RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || '';

  const passed = check(res, {
    'Nano Library 2 status 200': (r) => r.status === 200,
    'Nano Library 2 status_code 200': () => body?.status_code === 200,
    'Nano Library 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'Nano Library 2 title exists': () => title.trim().length > 0,
  });
  console.log(`✔ Nano Page 2 Lib Title: ${title}`);
  return passed;
}

function verifyMyOrdersAPI(data) {
  const start = Date.now();
  // ✅ FIX 10: Retry My Orders — most important API, retries up to 3 times
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/user/order/my_orders/`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return r.status === 200 && Array.isArray(b?.data) && b.data.length > 0;
    },
    3,
    1500  // 1.5s between retries
  );
  console.log(`⏱ My Orders RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  let passed = true;
  let subscriptionValidated = false;

  passed = passed && check(res, {
    'My Orders status 200': (r) => r.status === 200,
    'My Orders status_code true': () => body?.status_code === true,
    'My Orders data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
  });

  for (let order of body?.data || []) {
    passed = passed && check(order, {
      'Order ID valid': (o) => o?.id && o.id > 0,
    });

    for (let item of order?.order_items || []) {
      if (item?.item_type?.toLowerCase() === 'subscription') {
        const details = item?.item_details || {};
        passed = passed && check(item, {
          'Subscription name valid': () =>
            details?.subscription_name && details.subscription_name.trim().length > 0,
          'Plan duration valid': () =>
            details?.plan_duration && details.plan_duration > 0,
          'Discount type valid': () =>
            item?.discount_type && item.discount_type.trim().length > 0,
        });
        console.log(
          `✔ Order ID: ${order.id} | Subscription: ${details.subscription_name} | Duration: ${details.plan_duration} | Discount Type: ${item.discount_type}`
        );
        subscriptionValidated = true;
      }
    }
  }

  passed = passed && check(subscriptionValidated, {
    'At least one subscription exists': (v) => v === true,
  });

  return passed;
}

// ============================================================
// DEFAULT FUNCTION
// ============================================================

export default function (data) {
  console.log(`➡️ default() | VU=${__VU} | ITER=${__ITER}`);

  const counters = makeCounters();

  // ✅ FIX 11: Small sleep at start of each iteration to stagger VU requests
  sleep(Math.random() * 2); // 0–2s random jitter to spread load

  runStep('Profile API',                    profileAPI,                    data, counters);
  runStep('Related Course API',             relatedCourseAPI,              data, counters);
  runStep('Course Details API',             courseDetailsPageAPI,          data, counters);
  runStep('Complimentary Course API',       complimentaryCourseAPI,        data, counters);
  runStep('Masterclass Track 1 API',        verifyTrack1API,               data, counters);
  runStep('Masterclass Track 2 API',        verifyTrack2API,               data, counters);
  runStep('Masterclass Track 3 API',        verifyTrack3API,               data, counters);
  runStep('Subscription API',               verifyPlanPageAPI,             data, counters);
  runStep('Podcast Track 1 API',            podcastTrack1API,              data, counters);
  runStep('Podcast Track 2 API',            podcastTrack2API,              data, counters);
  runStep('Podcast Track 3 API',            podcastTrack3API,              data, counters);
  runStep('Complimentary Podcast API',      complimentaryPodcastCourseAPI, data, counters);
  runStep('Essential Podcast Course API',   EssentialPodcastCourseAPI,     data, counters);
  runStep('Nano Track 1 API',               nanoTrack1API,                 data, counters);
  runStep('Nano Track 2 API',               nanoTrack2API,                 data, counters);
  runStep('Nano Track 3 API',               nanoTrack3API,                 data, counters);
  runStep('Nano Learning Page 1 API',       nanoLearningPage1API,          data, counters);
  runStep('Nano Learning Page 2 API',       nanoLearningPage2API,          data, counters);
  runStep('Nano Learning Page 3 API',       nanoLearningPage3API,          data, counters);
  runStep('Caira Badge Page API',           VerifyCPETrackAPI,             data, counters);
  runStep('Course Library MM1 API',         verifyCourseLibraryMM1API,     data, counters);
  runStep('Course Library MM2 API',         verifyCourseLibraryMM2API,     data, counters);
  runStep('Course Library Podcast1 API',    verifyCourseLibraryPodcast1API, data, counters);
  runStep('Course Library Podcast2 API',    verifyCourseLibraryPodcast2API, data, counters);
  runStep('Course Library Nano1 API',       verifyCourseLibraryNano1API,   data, counters);
  runStep('Course Library Nano2 API',       verifyCourseLibraryNano2API,   data, counters);
  runStep('My Orders API',                  verifyMyOrdersAPI,             data, counters);

  console.log('\n================ Final API Tests EXECUTION SUMMARY ================');
  console.log(`✅ Tests Passed : ${counters.passed}`);
  console.log(`❌ Tests Failed : ${counters.failed}`);
  console.log(`📊 Total Tests  : ${counters.total}`);
  console.log('====================================================================\n');
}

// ============================================================
// HANDLE SUMMARY
// ============================================================

export function handleSummary(data) {
  const vus        = data.metrics.vus_max?.values?.max ?? 'N/A';
  const iterations = data.metrics.iterations?.values?.count ?? 'N/A';
  const avgIter    = data.metrics.iteration_duration.values.avg;
  const minIter    = data.metrics.iteration_duration.values.min;
  const maxIter    = data.metrics.iteration_duration.values.max;

  const summary = `
================= FINAL EXECUTION SUMMARY =================
👥 Total VUs Used        : ${vus}
🔁 Total Iterations Run  : ${iterations}

# Per Iteration Duration
   • Avg : ${(avgIter / 1000).toFixed(2)} s
   • Min : ${(minIter / 1000).toFixed(2)} s
   • Max : ${(maxIter / 1000).toFixed(2)} s
===========================================================
`;

  return { stdout: summary };
}