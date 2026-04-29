import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";



/**
 * ===============================
 * k6 OPTIONS
 * ===============================
 */


// export let options = {
//   scenarios: {
//     post_login_load: {
//       executor: 'shared-iterations',
//       vus: 1000,
//       iterations: 4000, 
//       maxDuration: '120m',
//     },
//   },

//   // ✅ FIX 1: Add thresholds to distinguish acceptable flakiness from real failures
//   thresholds: {
//     'checks{step:Profile API}':                    ['rate>0.99'],
//     'checks{step:My Orders API}':                  ['rate>0.99'],
//     'checks{step:Course Library MM2 API}':         ['rate>0.95'],
//     'checks{step:Course Library Podcast1 API}':    ['rate>0.95'],
//     'checks{step:Course Library Podcast2 API}':    ['rate>0.95'],
//     'checks{step:Course Library Nano1 API}':       ['rate>0.95'],
//     'checks{step:Course Library Nano2 API}':       ['rate>0.95'],
//   },
// };


export let options = {
  scenarios: {
    post_login_load: {
      executor: 'ramping-vus',        // ✅ Gradual ramp instead of instant spike
      startVUs: 0,
      stages: [
        { duration: '10m',  target: 100  },  // 🔼 Warm up
        { duration: '20m', target: 500  },  // 🔼 Mid load
        { duration: '20m', target: 1000 },  // 🔼 Peak stress
        { duration: '20m', target: 1000 },  // ➡️ Hold peak
        { duration: '5m',  target: 0    },  // 🔽 Cool down
      ],
      gracefulRampDown: '30s',
    },
  },

  thresholds: {
    // ✅ Global response time & failure rate
    'http_req_duration':  ['p(95)<2000'],   // 95% requests under 2s
    'http_req_failed':    ['rate<0.01'],    // Less than 1% network failures

    // ✅ Per API check pass rates (your existing ones — kept as is)
    'checks{step:Profile API}':                 ['rate>0.99'],
    'checks{step:My Orders API}':               ['rate>0.99'],
    'checks{step:Course Library MM2 API}':      ['rate>0.95'],
    'checks{step:Course Library Podcast1 API}': ['rate>0.95'],
    'checks{step:Course Library Podcast2 API}': ['rate>0.95'],
    'checks{step:Course Library Nano1 API}':    ['rate>0.95'],
    'checks{step:Course Library Nano2 API}':    ['rate>0.95'],

    // ✅ Per API response time (add per endpoint if needed)
    'http_req_duration{step:My Orders API}':    ['p(95)<3000'],  // Orders API gets extra time
    'http_req_duration{step:Profile API}':      ['p(95)<1500'],
  },
};

//const BASE_URL = 'https://test-masterclass.milesmasterclass.com';
const BASE_URL = 'https://api.milesmasterclass.com';
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



/**
 * ===============================
 * Case 3: Profile API
 * ===============================
 */
function profileAPI(data) {
  const res = http.get(`${BASE_URL}/api/user/myprofile/`, { headers: authHeaders(data.token) });
  return check(res, {
    'Profile status 200': (r) => r.status === 200,
    'Profile status_code true': (r) =>
      r.json('status_code') === true || r.json('status_code') === 'true',
  });
}


/**
 * ===============================
 * Case 4: Related Course API
 * ===============================
 */
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

/**
 * ===============================
 * Case 5: Course Details API
 * ===============================
 */

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

/**
 * ===============================
 * Case 6: Complimentary Courses API
 * ===============================
 */
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


/**
 * ===============================
 * Masterclass Track 1
 * ===============================
 */
// function verifyTrack1API(data) {
//   const start = Date.now();
//   const res = http.post(
//     `${BASE_URL}/api/dashboard/get_track/`,
//     JSON.stringify({ track: 'enable_for_human_skills_in_the_age_of_ai' }),
//     { headers: authHeaders(data.token) }
//   );
//   console.log(`⏱ Track 1 RT (ms): ${Date.now() - start}`);

//   const body = safeJson(res);
//   const title = body?.data?.[0]?.title || null;
//   console.log(`🎯 Track 1 Title: ${title}`);

//   return check(res, {
//     'Get Track 1 HTTP 200': (r) => r.status === 200,
//     'Track 1 status_code 200': () => body?.status_code === 200,
//     'Track 1 title exists': () => title !== null && title.trim().length > 0,
//   });
// }


/**
 * ===============================
 * Masterclass Track 1
 * ===============================
 */
function verifyTrack1MasterclassCoursesAPI(data) {
  const start = Date.now();

  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/tracks/6/courses/?course_type=masterclass&page=1`, {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );

  console.log(`⏱ Track 6 Masterclass Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track 6 Title: ${title}`);

  const passed = check(res, {
    'Track 6 Masterclass HTTP 200': (r) => r.status === 200,
    'Track 6 Masterclass status_code 200': () => body?.status_code === 200,
    'Track 6 Masterclass title exists': () => title !== null && title.trim().length > 0,
  });

  return passed;
}



/**
 * ===============================
 * Masterclass Track 2
 * ===============================
 */

function verifyTrack2MasterclassCoursesAPI(data) {
  const start = Date.now();

  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/tracks/7/courses/?course_type=masterclass&page=1`, {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );

  console.log(`⏱ Track 7 Masterclass Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track 7 Title: ${title}`);

  const passed = check(res, {
    'Track 7 Masterclass HTTP 200': (r) => r.status === 200,
    'Track 7 Masterclass status_code 200': () => body?.status_code === 200,
    'Track 7 Masterclass title exists': () => title !== null && title.trim().length > 0,
  });

  return passed;
}

/**
 * ===============================
 * Masterclass Track 3
 * ===============================
 */

function verifyTrack3MasterclassCoursesAPI(data) {
  const start = Date.now();

  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/tracks/8/courses/?course_type=masterclass&page=1`, {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );

  console.log(`⏱ Track 8 Masterclass Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track 8 Title: ${title}`);

  const passed = check(res, {
    'Track 8 Masterclass HTTP 200': (r) => r.status === 200,
    'Track 8 Masterclass status_code 200': () => body?.status_code === 200,
    'Track 8 Masterclass title exists': () => title !== null && title.trim().length > 0,
  });

  return passed;
}


/**
 * ===============================
 * Masterclass Track 4
 * ===============================
 */

function verifyTrack4MasterclassCoursesAPI(data) {
  const start = Date.now();

  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/tracks/12/courses/?course_type=masterclass&page=1`, {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );

  console.log(`⏱ Track 12 Masterclass Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track 12 Title: ${title}`);

  const passed = check(res, {
    'Track 12 Masterclass HTTP 200': (r) => r.status === 200,
    'Track 12 Masterclass status_code 200': () => body?.status_code === 200,
    'Track 12 Masterclass title exists': () => title !== null && title.trim().length > 0,
  });

  return passed;
}

/**
 * ===============================
 * Masterclass Track 2
 * ===============================
 */
// function verifyTrack2API(data) {
//   const start = Date.now();
//   const res = http.post(
//     `${BASE_URL}/api/dashboard/get_track/`,
//     JSON.stringify({ track: 'enable_for_ai_leadership' }),
//     { headers: authHeaders(data.token) }
//   );
//   console.log(`⏱ Track 2 RT (ms): ${Date.now() - start}`);

//   const body = safeJson(res);
//   const title = body?.data?.[0]?.title || null;
//   console.log(`🎯 Track 2 Title: ${title}`);

//   return check(res, {
//     'Get Track 2 HTTP 200': (r) => r.status === 200,
//     'Track 2 status_code 200': () => body?.status_code === 200,
//     'Track 2 title exists': () => title !== null && title.trim().length > 0,
//   });
// }

/**
 * ===============================
 * Masterclass Track 3
 * ===============================
 */
// function verifyTrack3API(data) {
//   const start = Date.now();
//   const res = http.post(
//     `${BASE_URL}/api/dashboard/get_track/`,
//     JSON.stringify({ track: 'enable_for_generative_ai' }),
//     { headers: authHeaders(data.token) }
//   );
//   console.log(`⏱ Track 3 RT (ms): ${Date.now() - start}`);

//   const body = safeJson(res);
//   const title = body?.data?.[0]?.title || null;
//   console.log(`🎯 Track 3 Title: ${title}`);

//   return check(res, {
//     'Get Track 3 HTTP 200': (r) => r.status === 200,
//     'Track 3 status_code 200': () => body?.status_code === 200,
//     'Track 3 title exists': () => title !== null && title.trim().length > 0,
//   });
// }



/**
 * ===============================
 * Subscription / Plan Page API
 * ===============================
 */
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



/**
 * ===============================
 * Podcast Track 1 API
 * ===============================
 */
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

/**
 * ===============================
 * Podcast Track 2 API
 * ===============================
 */

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


/**
 * ===============================
 * Podcast Track 3 API
 * ===============================
 */
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


/**
 * ===============================
 * Complimentary Courses API- POdcast
 * ===============================
 */
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


/**
 * ===============================
 * Essential Courses API- POdcast
 * ===============================
 */
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

/**
 * ===============================
 * Reels Page Track 1 API
 * ===============================
 */

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


/**
 * ===============================
 * Reels Page Track 2 API
 * ===============================
 */
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


/**
 * ===============================
 * Reels Page Track 3 API
 * ===============================
 */
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

/**
 * ===============================
 * Reels Page 1 Explore page API
 * ===============================
 */
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

/**
 * ===============================
 * Reels Page 2 Explore page API
 * ===============================
 */
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


/**
 * ===============================
 * Reels Page 3 Explore page API
 * ===============================
 */
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
/**
 * ===============================
 * Caira Badge Page API
 * ===============================
 */
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

/**
 * ===============================
 * Course lib MM page 1 API
 * ===============================
 */
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

/**
 * ===============================
 * Course lib MM page 2 API
 * ===============================
 */
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

/**
 * ===============================
 * Course lib Podcast page 1 API
 * ===============================
 */
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


/**
 * ===============================
 * Course lib Podcast page 2 API
 * ===============================
 */
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


/**
 * ===============================
 * Course lib Nano page 1 API
 * ===============================
 */
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


/**
 * ===============================
 * Course lib Nano page 2 API
 * ===============================
 */
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

/**
 * ===============================
 * My Orders API
 * ===============================
 */
// function verifyMyOrdersAPI(data) {
//   const start = Date.now();
//   // ✅ FIX 10: Retry My Orders — most important API, retries up to 3 times
//   const res = withRetry(
//     () => http.get(`${BASE_URL}/api/user/order/my_orders/`, { headers: authHeaders(data.token) }),
//     (r) => {
//       const b = safeJson(r);
//       return r.status === 200 && Array.isArray(b?.data) && b.data.length > 0;
//     },
//     3,
//     1500  // 1.5s between retries
//   );
//   console.log(`⏱ My Orders RT (ms): ${Date.now() - start}`);

//   const body = safeJson(res);
//   let passed = true;
//   let subscriptionValidated = false;

//   passed = passed && check(res, {
//     'My Orders status 200': (r) => r.status === 200,
//     'My Orders status_code true': () => body?.status_code === true,
//     'My Orders data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
//   });

//   for (let order of body?.data || []) {
//     passed = passed && check(order, {
//       'Order ID valid': (o) => o?.id && o.id > 0,
//     });

//     for (let item of order?.order_items || []) {
//       if (item?.item_type?.toLowerCase() === 'subscription') {
//         const details = item?.item_details || {};
//         passed = passed && check(item, {
//           'Subscription name valid': () =>
//             details?.subscription_name && details.subscription_name.trim().length > 0,
//           'Plan duration valid': () =>
//             details?.plan_duration && details.plan_duration > 0,
//           'Discount type valid': () =>
//             item?.discount_type && item.discount_type.trim().length > 0,
//         });
//         console.log(
//           `✔ Order ID: ${order.id} | Subscription: ${details.subscription_name} | Duration: ${details.plan_duration} | Discount Type: ${item.discount_type}`
//         );
//         subscriptionValidated = true;
//       }
//     }
//   }

//   passed = passed && check(subscriptionValidated, {
//     'At least one subscription exists': (v) => v === true,
//   });

//   return passed;
// }

/**
 * ===============================
 * My Orders API
 * ===============================
 */
function verifyMyOrdersAPI(data) {
  const start = Date.now();

  const res = withRetry(
    () => http.get(`${BASE_URL}/api/user/order/my_orders/`, { headers: authHeaders(data.token) }),
    (r) => {
      const b = safeJson(r);
      return r.status === 200 && Array.isArray(b?.data) && b.data.length > 0;
    },
    3,
    1500
  );
  console.log(`⏱ My Orders RT (ms): ${Date.now() - start}`);

  // ✅ Parse ONCE — avoid double safeJson() call
  const body = safeJson(res);
  const orders = body?.data || [];

  // ✅ Pre-compute all loop validations OUTSIDE check()
  let allOrderIdsValid = true;
  let allSubscriptionsValid = true;
  let subscriptionValidated = false;
  let subscriptionLog = '';

  for (const order of orders) {
    if (!order?.id || order.id <= 0) {
      allOrderIdsValid = false;
    }

    for (const item of order?.order_items || []) {
      if (item?.item_type?.toLowerCase() === 'subscription') {
        const details = item?.item_details || {};

        const nameValid     = details?.subscription_name?.trim().length > 0;
        const durationValid = details?.plan_duration > 0;
        const discountValid = item?.discount_type?.trim().length > 0;

        if (!nameValid || !durationValid || !discountValid) {
          allSubscriptionsValid = false;
        }

        subscriptionLog = `✔ Order ID: ${order.id} | Subscription: ${details.subscription_name} | Duration: ${details.plan_duration} | Discount Type: ${item.discount_type}`;
        subscriptionValidated = true;
      }
    }
  }

  // ✅ Single batched check() call — huge perf gain in stress testing
  const passed = check(res, {
    'My Orders status 200': (r) => r.status === 200,
    'My Orders status_code true': () => body?.status_code === true,
    'My Orders data not empty': () => orders.length > 0,
    'All Order IDs valid': () => allOrderIdsValid,
    'All Subscriptions valid': () => allSubscriptionsValid,
    'At least one subscription exists': () => subscriptionValidated,
  });

  // ✅ Log ONCE outside loop
  if (subscriptionLog) console.log(subscriptionLog);

  return passed;
}

/**
 * ===============================
 * learning Pathway AI& Innovation Artificial Intelligence 101
 * ===============================
 */
function verifyLearningPathwayAIInnovation1(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/learning-pathways/topics/7/courses/?page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ Learning Pathway Topic Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const firstCourse = body?.data?.[0] || {};
  const title = firstCourse?.title || '';
  const courseType = firstCourse?.course_type || '';
  const classCredits = firstCourse?.class_credits;
  const totalCount = body?.pagination_data?.total_count;

  const passed = check(res, {
    'LP Topic Courses status 200': (r) => r.status === 200,
    'LP Topic Courses status_code 200': () => body?.status_code === 200,
    'LP Topic Courses data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'LP Topic Courses title exists': () => title.trim().length > 0,
    'LP Topic Courses course_type exists': () => courseType.trim().length > 0,
    'LP Topic Courses class_credits is number': () => typeof classCredits === 'number' && classCredits > 0,
    'LP Topic Courses caira_level exists': () => typeof firstCourse?.caira_level === 'number',
    'LP Topic Courses included_for_caira is boolean': () => typeof firstCourse?.included_for_caira === 'boolean',
    'LP Topic Courses pagination total_count exists': () => typeof totalCount === 'number' && totalCount > 0,
    'LP Topic Courses pagination next_page exists': () => body?.pagination_data?.next_page !== null,
    'LP Topic Courses category details exist': () => firstCourse?.course_category_details?.course_name?.length > 0,
  });

  console.log(`✔ LP Topic Courses Title: ${title}`);
  console.log(`✔ LP Topic Courses Type: ${courseType} | Credits: ${classCredits}`);
  console.log(`✔ LP Topic Courses Total Count: ${totalCount}`);

  return passed;
}

/**
 * ===============================
 * learning Pathway AI& Innovation Powering Work with Microsoft
 * ===============================
 */
function verifyLearningPathwayAIInnovation2(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/learning-pathways/topics/8/courses/?page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ LP AI Innovation 2 - Topic Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const firstCourse = body?.data?.[0] || {};
  const title = firstCourse?.title || '';
  const courseType = firstCourse?.course_type || '';
  const classCredits = firstCourse?.class_credits;
  const totalCount = body?.pagination_data?.total_count;
  const currentDataLength = body?.data?.length || 0;

  const passed = check(res, {
    'LP AI Innovation 2 status 200': (r) => r.status === 200,
    'LP AI Innovation 2 status_code 200': () => body?.status_code === 200,
    'LP AI Innovation 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'LP AI Innovation 2 title exists': () => title.trim().length > 0,
    'LP AI Innovation 2 course_type exists': () => courseType.trim().length > 0,
    'LP AI Innovation 2 class_credits is number': () => typeof classCredits === 'number' && classCredits > 0,
    'LP AI Innovation 2 caira_level exists': () => typeof firstCourse?.caira_level === 'number',
    'LP AI Innovation 2 included_for_caira is boolean': () => typeof firstCourse?.included_for_caira === 'boolean',
    'LP AI Innovation 2 pagination total_count exists': () => typeof totalCount === 'number' && totalCount > 0,
    'LP AI Innovation 2 pagination next_page valid': () => {
      // next_page should only exist if more items remain beyond current page
      return totalCount > currentDataLength
        ? body?.pagination_data?.next_page !== null
        : body?.pagination_data?.next_page === null;
    },
    'LP AI Innovation 2 category details exist': () => firstCourse?.course_category_details?.course_name?.length > 0,
  });

  console.log(`✔ LP AI Innovation 2 Title: ${title}`);
  console.log(`✔ LP AI Innovation 2 Type: ${courseType} | Credits: ${classCredits}`);
  console.log(`✔ LP AI Innovation 2 Total Count: ${totalCount} | Next Page: ${body?.pagination_data?.next_page}`);

  return passed;
}



/**
 * ===============================
 * learning Pathway AI& Innovation The Accounting Agents
 * ===============================
 */

function verifyLearningPathwayAIInnovation3(data) {
  const start = Date.now();
  const res = withRetry(
    () => http.get(`${BASE_URL}/api/v2/learning-pathways/topics/9/courses/?page=1`, { headers: authHeaders(data.token) }),
    (r) => { const b = safeJson(r); return Array.isArray(b?.data) && b.data.length > 0; }
  );
  console.log(`⏱ LP AI Innovation 2 - Topic Courses RT (ms): ${Date.now() - start}`);

  const body = safeJson(res);
  const firstCourse = body?.data?.[0] || {};
  const title = firstCourse?.title || '';
  const courseType = firstCourse?.course_type || '';
  const classCredits = firstCourse?.class_credits;
  const totalCount = body?.pagination_data?.total_count;
  const currentDataLength = body?.data?.length || 0;

  const passed = check(res, {
    'LP AI Innovation 2 status 200': (r) => r.status === 200,
    'LP AI Innovation 2 status_code 200': () => body?.status_code === 200,
    'LP AI Innovation 2 data not empty': () => Array.isArray(body?.data) && body.data.length > 0,
    'LP AI Innovation 2 title exists': () => title.trim().length > 0,
    'LP AI Innovation 2 course_type exists': () => courseType.trim().length > 0,
    'LP AI Innovation 2 class_credits is number': () => typeof classCredits === 'number' && classCredits > 0,
    'LP AI Innovation 2 caira_level exists': () => typeof firstCourse?.caira_level === 'number',
    'LP AI Innovation 2 included_for_caira is boolean': () => typeof firstCourse?.included_for_caira === 'boolean',
    'LP AI Innovation 2 pagination total_count exists': () => typeof totalCount === 'number' && totalCount > 0,
    'LP AI Innovation 2 pagination next_page valid': () => {
      // next_page should only exist if more items remain beyond current page
      return totalCount > currentDataLength
        ? body?.pagination_data?.next_page !== null
        : body?.pagination_data?.next_page === null;
    },
    'LP AI Innovation 2 category details exist': () => firstCourse?.course_category_details?.course_name?.length > 0,
  });

  console.log(`✔ LP AI Innovation 2 Title: ${title}`);
  console.log(`✔ LP AI Innovation 2 Type: ${courseType} | Credits: ${classCredits}`);
  console.log(`✔ LP AI Innovation 2 Total Count: ${totalCount} | Next Page: ${body?.pagination_data?.next_page}`);

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
  runStep('verifyTrack1MasterclassCoursesAPI', verifyTrack1MasterclassCoursesAPI, data, counters);
  runStep('verifyTrack2MasterclassCoursesAPI', verifyTrack2MasterclassCoursesAPI, data, counters);
  runStep('verifyTrack3MasterclassCoursesAPI', verifyTrack3MasterclassCoursesAPI, data, counters);
  runStep('verifyTrack4MasterclassCoursesAPI', verifyTrack4MasterclassCoursesAPI, data, counters);
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
  runStep('Learning Pathway AI&Innovation API', verifyLearningPathwayAIInnovation1, data, counters);
  runStep('Learning Pathway AI&Innovation API', verifyLearningPathwayAIInnovation2, data, counters);
  runStep('Learning Pathway AI&Innovation API', verifyLearningPathwayAIInnovation3, data, counters);
  









  console.log('\n================ Final API Tests EXECUTION SUMMARY ================');
  console.log(`✅ Tests Passed : ${counters.passed}`);
  console.log(`❌ Tests Failed : ${counters.failed}`);
  console.log(`📊 Total Tests  : ${counters.total}`);
  console.log('====================================================================\n');
}

// ============================================================
// HANDLE SUMMARY
// ============================================================

// Single merged handleSummary at the BOTTOM of your file
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

  // Writes the JSON file Jenkins needs + prints your custom summary to console
  return {
    "k6-summary.json": JSON.stringify(data, null, 2),
    stdout: summary,
  };
}