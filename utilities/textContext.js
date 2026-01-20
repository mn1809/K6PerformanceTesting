export let totalSteps = 0;
export let passedSteps = 0;
export let failedSteps = 0;

export function resetCounters() {
  totalSteps = 0;
  passedSteps = 0;
  failedSteps = 0;
}

export function runStep(stepName, stepFn, data) {
  totalSteps++;
  console.log(`\n Test ${totalSteps}: ${stepName}`);

  let passed = false;
  try {
    passed = stepFn(data);
  } catch (e) {
    console.error(`❌ ERROR in ${stepName}: ${e.message}`);
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
