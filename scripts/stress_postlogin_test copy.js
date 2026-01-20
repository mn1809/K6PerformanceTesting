import http from 'k6/http';
import { check } from 'k6';
let totalSteps = 0;
let passedSteps = 0;
let failedSteps = 0;


/**
 * ===============================
 * k6 OPTIONS
 * ===============================
 */
export let options = {
  scenarios: {
    post_login_load: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,        // Increase this for load
      maxDuration: '10m',
    },
  },
};

const BASE_URL = 'https://test-masterclass.milesmasterclass.com';
const email = 'manoj.hr@mileseducation.com';
const otp = '654987';


// function runStep(stepName, stepFn, data) {
//   const passed = stepFn(data);

//   console.log(
//     passed
//       ? `${stepName} PASSED`
//       : `${stepName} FAILED`
//   );
// console.log('===========================================================================');
//   return passed; // optional, in case you want stats later
// }
function runStep(stepName, stepFn, data) 
{
  totalSteps++;

  console.log(`\n Test ${totalSteps}: ${stepName}`);

  let passed = false;
  try {
    passed = stepFn(data);
  } catch (e) {
    console.error(`❌ ERROR in ${stepName}: ${e.message}`);
    passed = false;
  }
  if (passed) {
    passedSteps++;
    console.log(`✅ RESULT: ${stepName} PASSED`);
  } else {
    failedSteps++;
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
  // Case 1: Send OTP
  const sendOtpResponse = http.post(
    `${BASE_URL}/api/send-otp-to-phone`,
    JSON.stringify({ email }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const sessionId = sendOtpResponse.json('data.result.session_id');
  console.log(`Session ID: ${sessionId}`);

  // Case 2: Verify OTP
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
 * ===============================
 * Case 3: Profile API
 * ===============================
 */
function profileAPI(data) {
  const res = http.get(
    `${BASE_URL}/api/user/myprofile/`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        'x-app-type': 'WA',
      },
    }
  );

  const passed = check(res, {
    'Profile status 200': (r) => r.status === 200,
    'Profile status_code true': (r) =>
      r.json('status_code') === true || r.json('status_code') === 'true',
  });
    return passed; 
}

/**
 * ===============================
 * Case 4: Related Course API
 * ===============================
 */
function relatedCourseAPI(data) 
{
  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/api/dashboard/related_content/`,
    JSON.stringify({ masterclass_id: 135 }),
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Related Course RT: ${Date.now() - start} ms`);

  const jsonData = safeJson(res);

// If jsonData is null, default to empty array
  //const relatedCourses = jsonData?.data || [];
  //const titles = (res.json('data') || [])
  const titles = (jsonData?.data || [])
    .map(item => item.title)
    .filter(Boolean);

  titles.forEach((t, i) =>
    console.log(`📘 Related Course ${i + 1}: ${t}`)
  );

  const passed = check(res, {
    'Related API status 200': (r) => r.status === 200,
    'At least one related course title present': () => titles.length > 0,
  });
  return passed; 
}

/**
 * ===============================
 * Case 5: Course Details API
 * ===============================
 */
function courseDetailsPageAPI(data) 
{
  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/masterclass/details/?id=128`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Course Details RT: ${Date.now() - start} ms`);
  const jsonData = safeJson(res);

  const title = jsonData?.data?.title || '❌ Title not found';
  console.log(`📘 Course Title: ${title}`);

 const passed = check(res, 
    {
    'Course Details status 200': (r) => r.status === 200,
    'Course title present': () => title !== '❌ Title not found',
    'status_code is 200': (r) =>
      r.json('status_code') === 200 || r.json('status_code') === '200',
  });
  return passed;
}

/**
 * ===============================
 * Case 6: Complimentary Courses API
 * ===============================
 */
function complimentaryCourseAPI(data) {

  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/complimentary-course/?course_type=masterclass&page=1`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Complimentary Course RT (ms): ${Date.now() - start}`);

  // ✅ SAFE extraction (handles all response shapes)
  const body = res.json();

  let title =
   body?.data?.[0]?.title ||
    '❌ Title not found';
  console.log(` Complimentary Course Title: ${title}`);
  // ✅ Assertions
  const passed = check(res, {
    'Complimentary API status 200': (r) => r.status === 200,
    'First course title exists': () => title !== '❌ Title not found',
  });
  return passed;
}

/**
 * ===============================
 * Masterclass Track 1
 * ===============================
 */
function verifyTrack1API(data) {

  const payload = JSON.stringify({
    track: "enable_for_human_skills_in_the_age_of_ai",
  });

  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    payload,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Get Track API RT (ms): ${Date.now() - start}`);

  const body = res.json();

  // ✅ EXACT extraction based on response
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track Title: ${title}`);

  const passed = check(res, {
    'Get Track API HTTP 200': (r) => r.status === 200,
    'Response status_code is 200': () => body?.status_code === 200,
    'Track title exists': () => title !== null && title.trim().length > 0,
  });
  return passed;
}

/**
 * ===============================
 * Masterclass Track 2
 * ===============================
 */
function verifyTrack2API(data) {

  const payload = JSON.stringify({
    track: "enable_for_ai_leadership",
  });

  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    payload,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Get Track API RT (ms): ${Date.now() - start}`);

  const body = res.json();

  // ✅ EXACT extraction based on response
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track Title: ${title}`);

  const passed = check(res, {
    'Get Track API HTTP 200': (r) => r.status === 200,
    'Response status_code is 200': () => body?.status_code === 200,
    'Track title exists': () => title !== null && title.trim().length > 0,
  });
  return passed;  
}



/**
 * ===============================
 * Masterclass Track 3
 * ===============================
 */
function verifyTrack3API(data) {

  const payload = JSON.stringify({
    track: "enable_for_generative_ai",
  });

  const start = Date.now();

  const res = http.post(
    `${BASE_URL}/api/dashboard/get_track/`,
    payload,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Get Track API RT (ms): ${Date.now() - start}`);

  const body = res.json();

  // ✅ EXACT extraction based on response
  const title = body?.data?.[0]?.title || null;

  console.log(`🎯 Track Title: ${title}`);

  const passed = check(res, {
    'Get Track API HTTP 200': (r) => r.status === 200,
    'Response status_code is 200': () => body?.status_code === 200,
    'Track title exists': () => title !== null && title.trim().length > 0,
  });
  return passed;
}


/**
 * ===============================
 * Subscription / Plan Page API
 * ===============================
 */
function verifyPlanPageAPI(data) {

  check(data, {
    'Token is not null': () => data.token !== null && data.token !== undefined,
  });

  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/promotion/subscription/`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        'x-app-type': 'WA',
      },
    }
  );

  const body = safeJson(res);

  console.log(`⏱ Subscription API RT (ms): ${Date.now() - start}`);

 // const body = res.json();

  // // ✅ Get subscription_name from API response
  // const subscriptionName = body?.data?.[0]?.subscription_name || '❌ Not found';

 // ✅ DEFINE plans ONCE in function scope
  const plans = Array.isArray(body?.data) ? body.data : [];


body?.data?.forEach(plan => {
  console.log(`Plans on Subscription page: ${plan.subscription_name}`);
});

  // ✅ Minimal validations (optional but recommended)
  const passed = check(res, {
    'Subscription API HTTP 200': (r) => r.status === 200,
    'Response status_code is 200': () => body?.status_code === 200,
    'Subscription list is not empty': () => plans.length > 0,
    'All plans have valid subscription_name': () =>
      plans.every(
        (plan) =>
          plan.subscription_name &&
          plan.subscription_name.trim().length > 0
      ),
  });
  return passed;
}




/**
 * ===============================
 * Podcast Courses – Track 1
 * ===============================
 */
function podcastTrack1API(data) 
{

  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/v2/tracks/6/courses/?course_type=podcast&page=1`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  
  console.log(`⏱ Podcast Track 6 RT (ms): ${Date.now() - start}`);

  const body = res.json();
  const title = body?.results?.[0]?.title || 'Title not found';

  console.log(`🎧 Podcast Track 6 Title: ${title}`);

  const passed = check(res, {
    'Podcast Track 6 status 200': (r) => r.status === 200,
    'Podcast Track 6 title exists': () => title !== 'Title not found',
  });
  return passed;
}

/**
 * ===============================
 * Podcast Courses – Track 2
 * ===============================
 */
function podcastTrack2API(data) {

  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/v2/tracks/7/courses/?course_type=podcast&page=1`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );
  console.log(`⏱ Podcast Track 2 RT (ms): ${Date.now() - start}`);
  const body = res.json();
  const title = body?.results?.[0]?.title || 'Title not found';
  console.log(`🎧 Podcast Track 2 Title: ${title}`);
  const passed = check(res, {
    'Podcast Track 2 status 200': (r) => r.status === 200,
    'Podcast Track 2 title exists': () => title !== 'Title not found',
  });
  return passed;
}

/**
 * ===============================
 * Podcast Courses – Track 3
 * ===============================
 */
function podcastTrack3API(data) {
  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v2/tracks/8/courses/?course_type=podcast&page=1`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );
  console.log(`⏱ Podcast Track 3 RT (ms): ${Date.now() - start}`);
  const body = res.json();
  const title = body?.results?.[0]?.title || 'Title not found';
  console.log(`🎧 Podcast Track 3 Title: ${title}`);
  const passed = check(res, {
    'Podcast Track 3 status 200': (r) => r.status === 200,
    'Podcast Track 3 title exists': () => title !== 'Title not found',
  });
  return passed;
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
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Complimentary Course RT (ms): ${Date.now() - start}`);

  // ✅ SAFE extraction (handles all response shapes)
  const body = res.json();

  let title = body?.data?.[0]?.title || '❌ Title not found';
  console.log(` Podcast Complimentary Course Title: ${title}`);
  // ✅ Assertions
  const passed = check(res, {
    'Complimentary API status 200': (r) => r.status === 200,
    'First course title exists': () => title !== '❌ Title not found',
  });
  return passed;
}


/**
 * ===============================
 * Complimentary Courses API- POdcast
 * ===============================
 */
function EssentialPodcastCourseAPI(data) {

  const start = Date.now();

  const res = http.get(
    `${BASE_URL}/api/dashboard/latest_podcast/?course_type=podcast&page=1`,
    {
      headers: {
        Authorization: `bearer ${data.token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  console.log(`⏱ Complimentary Course RT (ms): ${Date.now() - start}`);

  // ✅ SAFE extraction (handles all response shapes)
  const body = res.json();

  let title = body?.data?.[0]?.title || '❌ Title not found';
  console.log(` Complimentary Course Title: ${title}`);
  // ✅ Assertions
  const passed = check(res, {
    'Complimentary API status 200': (r) => r.status === 200,
    'First course title exists': () => title !== '❌ Title not found',
  });
  return passed;
}







//-----==========================================================================================================================================================================------------------//
/**
 * Helper
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
 * default() → RUNS MANY TIMES
 * ===============================
 */
export default function (data) {
  console.log(`➡️ default() | VU=${__VU} | ITER=${__ITER}`);

  // reset counters per iteration
  totalSteps = 0;
  passedSteps = 0;
  failedSteps = 0;
  
  runStep('Profile API', profileAPI, data);
  runStep('Related Course API', relatedCourseAPI, data);
  runStep('Course Details API', courseDetailsPageAPI, data);
  runStep('Complimentary Course API', complimentaryCourseAPI, data);
  runStep('Masterclass Track 1 API', verifyTrack1API, data);
  runStep('Masterclass Track 2 API', verifyTrack2API, data);
  runStep('Masterclass Track 3 API', verifyTrack3API, data);
  runStep('Subscription API', verifyPlanPageAPI, data);
  runStep('Podcast Track 1 API', podcastTrack1API, data);
  runStep('Podcast Track 2 API', podcastTrack2API, data);
  runStep('Podcast Track 3 API', podcastTrack3API, data);
  runStep('Complimentary Podcast Course API', complimentaryPodcastCourseAPI, data);
  runStep('Essential Podcast Course API', EssentialPodcastCourseAPI, data);

  // FINAL SUMMARY
  console.log('\n================ Final API Tests EXECUTION SUMMARY ================');
  console.log(`✅ Tests Passed : ${passedSteps}`);
  console.log(`❌ Tests Failed : ${failedSteps}`);
  console.log(`📊 Total Tests : ${totalSteps}`);
  console.log('=======================================================\n');
}





export function handleSummary(data) 
{
  const vus = data.metrics.vus_max?.values?.max ?? 'N/A';
  const iterations = data.metrics.iterations?.values?.count ?? 'N/A';
  const avgIter = data.metrics.iteration_duration.values.avg;
  const minIter = data.metrics.iteration_duration.values.min;
  const maxIter = data.metrics.iteration_duration.values.max;

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

  return {
    stdout: summary,
  };
}


