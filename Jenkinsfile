pipeline {
    agent any
    environment {
        K6_SCRIPT = 'scripts/stress_postlogin_test.js'
        LOGS_DIR = 'logs'
    }

    stages {
        stage('Verify k6') {
            steps {
                script {
                    if (isUnix()) {
                        sh 'k6 version'
                    } else {
                        bat 'k6 version'
                    }
                }
            }
        }

        stage('Run k6 Test') {
            steps {
                script {
                    // Ensure logs folder exists
                    if (isUnix()) {
                        sh "mkdir -p ${LOGS_DIR}"
                        sh "k6 run --out json=${LOGS_DIR}/k6-summary.json ${K6_SCRIPT}"
                    } else {
                        bat "if not exist ${LOGS_DIR} mkdir ${LOGS_DIR}"
                        bat "k6 run --out json=${LOGS_DIR}\\k6-summary.json %K6_SCRIPT%"
                    }
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'logs/**', allowEmptyArchive: true
        }

        failure {
            script {
                def TEST_COUNTS = getK6Summary("${env.WORKSPACE}/${LOGS_DIR}/k6-summary.json")
                sendK6Email(TEST_COUNTS, '❌ k6 Test Failed', 'red')
            }
        }

        success {
            script {
                def TEST_COUNTS = getK6Summary("${env.WORKSPACE}/${LOGS_DIR}/k6-summary.json")
                sendK6Email(TEST_COUNTS, '✅ k6 Test Success', 'green')
            }
        }
    }
}

// === Utility functions ===
def getK6Summary(String summaryFile) {
    def counts = [total: 0, pass: 0, fail: 0, skip: 0]
    if (fileExists(summaryFile)) {
        def summary = readJSON file: summaryFile
        counts.total = summary.metrics.iterations.count ?: 0
        counts.fail = summary.metrics.iterations.fails ?: 0
        counts.pass = counts.total - counts.fail
    }
    echo "K6 Summary: Total=${counts.total}, Pass=${counts.pass}, Fail=${counts.fail}"
    return counts
}

def sendK6Email(def counts, String subjectPrefix, String color) {
    def BUILD_DURATION = currentBuild.durationString ?: 'N/A'
    def BUILD_TIMESTAMP = new Date().format("yyyy-MM-dd HH:mm:ss")

    emailext(
        to: 'manoj.hr@mileseducation.com',
        subject: "${subjectPrefix}: ${currentBuild.fullDisplayName}",
        mimeType: 'text/html',
        attachmentsPattern: 'logs/**',
        body: """
Hello All,<br/><br/>

<center><strong>Daily Test Summary</strong></center><br/>

<table style="width:50%; border-collapse: collapse;" border="2">
  <tr>
    <td colspan="2" style="color: ${color}; text-align: center;">
      <strong>Execution Information</strong>
    </td>
  </tr>

  <tr>
    <td>Total number of test cases executed</td>
    <td>${counts.total}</td>
  </tr>
  <tr>
    <td>Passed test count</td>
    <td>${counts.pass}</td>
  </tr>
  <tr>
    <td>Failed test count</td>
    <td>${counts.fail}</td>
  </tr>
  <tr>
    <td>Skipped test count</td>
    <td>${counts.skip}</td>
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

<strong>We'll continue monitoring and fixing failures (if any).</strong><br/><br/>

Thanks &amp; Rgds,<br/>
Masterclass QA Team
"""
    )
}
