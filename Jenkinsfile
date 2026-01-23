pipeline {
    agent any

    environment {
        K6_SCRIPT = 'scripts/stress_postlogin_test.js'
    }

        stages {

    //     stage('Checkout Code') {
    //         steps {
    //             git branch: 'main',
    //                 url: 'https://github.com/mn1809/K6PerformanceTesting.git'
    //         }
    //     }

        stage('Verify k6') {
            steps {
                bat 'k6 version'
            }
        }

        stage('Run k6 Test') {
            steps {
                bat "k6 run ${K6_SCRIPT}"
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'logs/**', allowEmptyArchive: true
        }

        failure {
            echo '❌ k6 test failed'
        }

        success {
            echo '✅ k6 test completed successfully'
        }
    }
}