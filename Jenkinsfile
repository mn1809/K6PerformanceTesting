pipeline {
    agent any
    environment {
        K6_SCRIPT = 'scripts/stress_postlogin_test.js'
    }

    stages {
        stage('Verify k6') {
            steps {
                bat 'k6 version'
            }
        }

        stage('Run k6 Test') {
            steps {
                // Run k6 and save output to JSON for parsing
                bat "k6 run --out json=logs/k6-summary.json ${K6_SCRIPT}"
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'logs/**', allowEmptyArchive: true
        }

        failure {
            echo '❌ k6 test failed'

            script {
                def TEST_COUNTS = [total: 0, pass: 0, fail: 0, skip: 0]
                def BUILD_DURATION = currentBuild.durationString ?: 'N/A'
                def BUILD_TIMESTAMP = new Date().format("yyyy-MM-dd HH:mm:ss")

                def summaryFile = "${env.WORKSPACE}/logs/k6-summary.json"
                if (fileExists(summaryFile)) {
                    def summary = readJSON file: summaryFile
                    TEST_COUNTS.total = summary.metrics.iterations.count ?: 0
                    TEST_COUNTS.fail = summary.metrics.iterations.fails ?: 0
                    TEST_COUNTS.pass = TEST_COUNTS.total - TEST_COUNTS.fail
                    TEST_COUNTS.skip = 0
                }

                emailext(
                    to: 'manoj.hr@mileseducation.com',
                    subject: "❌ k6 Test Failed: ${currentBuild.fullDisplayName}",
                    mimeType: 'text/html',
                    attachmentsPattern: 'logs/**',
                    body: """
Hello All,<br/><br/>

<center><strong>Daily Test Summary</strong></center><br/>

<table style="width:50%; border-collapse: collapse;" border="2">
  <tr>
    <td colspan="2" style="color: red; text-align: center;">
      <strong>Execution Information</strong>
    </td>
  </tr>

  <tr>
    <td>Total number of test cases executed</td>
    <td>${TEST_COUNTS.total}</td>
  </tr>
  <tr>
    <td>Passed test count</td>
    <td>${TEST_COUNTS.pass}</td>
  </tr>
  <tr>
    <td>Failed test count</td>
    <td>${TEST_COUNTS.fail}</td>
  </tr>
  <tr>
    <td>Skipped test count</td>
    <td>${TEST_COUNTS.skip}</td>
  </tr>
  <tr>
    <td>Total Execution Time</td>
    <td>${BUILD_DURATION}</td>
  </tr>
  <tr>
    <td>WebApp Version</td>
    <td>Check attached version txt file</td>
  </tr>
  <tr>
    <td>Execution Start time</td>
    <td>${BUILD_TIMESTAMP}</td>
  </tr>
</table>

<br/><br/>
Attached Jenkins log files for QA team to review.<br/><br/>

<strong>
We'll continue monitoring and fixing failures (if any).
</strong><br/><br/>

Thanks &amp; Rgds,<br/>
Masterclass QA Team
"""
                )
            }
        }

        success {
            echo '✅ k6 test completed successfully'

            script {
                def TEST_COUNTS = [total: 0, pass: 0, fail: 0, skip: 0]
                def BUILD_DURATION = currentBuild.durationString ?: 'N/A'
                def BUILD_TIMESTAMP = new Date().format("yyyy-MM-dd HH:mm:ss")

                def summaryFile = "${env.WORKSPACE}/logs/k6-summary.json"
                if (fileExists(summaryFile)) {
                    def summary = readJSON file: summaryFile
                    TEST_COUNTS.total = summary.metrics.iterations.count ?: 0
                    TEST_COUNTS.fail = summary.metrics.iterations.fails ?: 0
                    TEST_COUNTS.pass = TEST_COUNTS.total - TEST_COUNTS.fail
                    TEST_COUNTS.skip = 0
                }

                emailext(
                    to: 'manoj.hr@mileseducation.com',
                    subject: "✅ k6 Test Success: ${currentBuild.fullDisplayName}",
                    mimeType: 'text/html',
                    attachmentsPattern: 'logs/**',
                    body: """
Hello All,<br/><br/>

<center><strong>Daily Test Summary</strong></center><br/>

<table style="width:50%; border-collapse: collapse;" border="2">
  <tr>
    <td colspan="2" style="color: green; text-align: center;">
      <strong>Execution Information</strong>
    </td>
  </tr>

  <tr>
    <td>Total number of test cases executed</td>
    <td>${TEST_COUNTS.total}</td>
  </tr>
  <tr>
    <td>Passed test count</td>
    <td>${TEST_COUNTS.pass}</td>
  </tr>
  <tr>
    <td>Failed test count</td>
    <td>${TEST_COUNTS.fail}</td>
  </tr>
  <tr>
    <td>Skipped test count</td>
    <td>${TEST_COUNTS.skip}</td>
  </tr>
  <tr>
    <td>Total Execution Time</td>
    <td>${BUILD_DURATION}</td>
  </tr>
  <tr>
    <td>WebApp Version</td>
    <td>Check attached version txt file</td>
  </tr>
  <tr>
    <td>Execution Start time</td>
    <td>${BUILD_TIMESTAMP}</td>
  </tr>
</table>

<br/><br/>
Attached Jenkins log files for QA team to review.<br/><br/>

<strong>
We'll continue monitoring and fixing failures (if any).
</strong><br/><br/>

Thanks &amp; Rgds,<br/>
Masterclass QA Team
"""
                )
            }
        }
    }
}
