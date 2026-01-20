import {
  totalSteps,
  passedSteps,
  failedSteps,
} from './textContext.js';

export function handleSummary(data) {
  const vus = data.metrics.vus_max?.values?.max ?? 'N/A';
  const iterations = data.metrics.iterations?.values?.count ?? 'N/A';

  const avgIter = data.metrics.iteration_duration.values.avg;
  const minIter = data.metrics.iteration_duration.values.min;
  const maxIter = data.metrics.iteration_duration.values.max;

  return {
    stdout: `
================ FINAL EXECUTION SUMMARY =================
👥 Total VUs Used        : ${vus}
🔁 Total Iterations Run  : ${iterations}

# Iteration Duration
   • Avg : ${(avgIter / 1000).toFixed(2)} s
   • Min : ${(minIter / 1000).toFixed(2)} s
   • Max : ${(maxIter / 1000).toFixed(2)} s

# Last Iteration API Stats
   ✅ Passed : ${passedSteps}
   ❌ Failed : ${failedSteps}
   📊 Total  : ${totalSteps}
===========================================================
`,
  };
}
