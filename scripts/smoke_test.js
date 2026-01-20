import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

/* =========================
   LOAD CONFIG
========================= */
export const options = {
  vus: 1,
  iterations: 5, // safe repeat checks
};


/* =========================
   CONSTANTS
========================= */
const BASE_URL = 'https://test-masterclass.milesmasterclass.com';
const EMAIL = 'manoj.hr@mileseducation.com';
const OTP = '654987';

/* =========================
   SETUP (RUNS ONCE)
========================= */
export function setup() {
  console.log('🚀 Setup started (OTP only once)');

  /* Send OTP */
  const sendOtpRes = http.post(
    `${BASE_URL}/api/send-otp-to-phone`,
    JSON.stringify({ email: EMAIL }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(sendOtpRes, {
    'Send OTP success': (r) => r.status === 201,
  });

  const sessionId = sendOtpRes.json('data.result.session_id');

  /* Verify OTP */
  const verifyOtpRes = http.post(
    `${BASE_URL}/api/verify-otp`,
    JSON.stringify({
      session_id: sessionId,
      otp: OTP,
      browser_session_id: `setup-${Date.now()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-app-type': 'WA',
      },
    }
  );

  check(verifyOtpRes, {
    'Verify OTP success': (r) => r.json('status') === 'true',
  });

  const token = verifyOtpRes.json('data.token');

  console.log('✅ Token generated once');

  // Optional: profile validation ONCE
  const profileRes = http.get(
    `${BASE_URL}/api/user/myprofile/`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-app-type': 'WA',
      },
    }
  );

  check(profileRes, {
    'Profile API OK': (r) => r.status === 200,
  });

  return { token };
}

/* =========================
   LOAD TEST (RUNS MANY TIMES)
========================= */
export default function (data) {
  const token = data.token;

  const relatedPayload = JSON.stringify({
    masterclass_id: 135,
  });

  const relatedRes = http.post(
    `${BASE_URL}/api/dashboard/related_content/`,
    relatedPayload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'x-app-type': 'WA',
      },
    }
  );

  check(relatedRes, {
    'Related content 200': (r) => r.status === 200,
    'Has title': (r) => r.body && r.body.includes('title'),
  });

  sleep(1);
}
