import {
  runStep,
  resetCounters,
} from '../utilities/textContext.js';


import {
  profileAPI,
  relatedCourseAPI,
  courseDetailsPageAPI,
  complimentaryCourseAPI,
  verifyTrack1API,
  verifyTrack2API,
  verifyTrack3API,
  verifyPlanPageAPI,
  podcastTrack1API,
  podcastTrack2API,
  podcastTrack3API,
  complimentaryPodcastCourseAPI,
  EssentialPodcastCourseAPI,
} from '../scripts/stress_postlogin_test.js';

export default function (data) {
  console.log(`➡️ default() | VU=${__VU} | ITER=${__ITER}`);

  resetCounters();

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

  console.log(`
================ Iteration Summary ================
✅ Passed : ${passedSteps}
❌ Failed : ${failedSteps}
📊 Total  : ${totalSteps}
==================================================
`);
}
