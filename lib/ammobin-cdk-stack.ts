import lambda = require('aws-cdk-lib/aws-lambda')
import cdk = require('aws-cdk-lib')
import dynamodb = require('aws-cdk-lib/aws-dynamodb')
import sqs = require('aws-cdk-lib/aws-sqs')
import { SqsEventSource, SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources'
import { Duration } from 'aws-cdk-lib'
import events = require('aws-cdk-lib/aws-events')
import sns = require('aws-cdk-lib/aws-sns')
import { RetentionDays } from 'aws-cdk-lib/aws-logs'
import { Secret } from 'aws-cdk-lib/aws-secretsmanager'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Alarm, Metric, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { Topic, } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'

import { AmmobinApiStack } from './ammobin-api-stack'
import { LOG_RETENTION, Stage, TEST_LAMBDA_NAME, REFRESH_HOURS, Region, RUNTIME, ARCH } from './constants'
import { CloudwatchScheduleEvent } from './CloudWatchScheduleEvent'
import { exportLambdaLogsToLogger, regionToAWSRegion } from './helper'
import { AmmobinImagesStack } from './ammobin-images-stack'

interface IAmmobinCdkStackProps extends cdk.StackProps {
  publicUrl: string,
  stage: Stage,
  apiCode?: string,
  email?: string
  region: Region
}

export class AmmobinCdkStack extends cdk.Stack {

  constructor(scope: cdk.App, id: string, props: IAmmobinCdkStackProps) {
    super(scope, id, props)

    const NODE_ENV = 'production'
    const DONT_LOG_CONSOLE = 'false'
    const PRIMARY_KEY = 'id'
    const TABLE_NAME = 'ammobinItems'
    const HASH_SECRET = 'TODO-REAL-SECRET' //
    const STAGE = props.stage
    const REGION = props.region // site's region

    // are we live in production?
    const is_prod_enabled = STAGE === 'prod'

    const itemsTable = new dynamodb.Table(this, 'table', {
      tableName: TABLE_NAME,
      partitionKey: {
        name: PRIMARY_KEY,
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl'
    })

    const { functionUrl } = new AmmobinImagesStack(this, 'ammobinImages', { url: 'images.' + props.publicUrl, stage: props.stage, region: props.region })
    this.exportValue(functionUrl.url, { name: 'imageFunctionUrl' })

    const CODE_BASE = (props.apiCode || '../ammobin-api') + '/lambda/'
    console.log('CODE_BASE', CODE_BASE, props)
    const apiName = 'apiLambda'
    const api = new AmmobinApiStack(this, 'ammobin-api', {
      name: apiName,
      CODE_BASE,
      url: 'api.' + props.publicUrl,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE,
        HASH_SECRET,
        STAGE,
        REGION,
      },
    })

    itemsTable.grantReadData(api.lambda)
    itemsTable.grantReadData(api.graphqlLambda)

    this.exportValue(api.graphqlFunctionUrl.url, { name: 'graphqlFunctionUrl' })
    this.exportValue(api.lambdaFunctionUrl.url, { name: 'lambdaFunctionUrl' })

    // TODO: manually update this key: https://ca-central-1.console.aws.amazon.com/secretsmanager/home?region=ca-central-1#/secret?name=rendertronUrl
    //https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_update-secret.html
    // note: not used currently b/c using internal pupeteer
    // const rendertronUrl = new sm.Secret(this, 'rendertronUrl', {
    //   secretName: 'rendertronUrl',
    //   description: 'url to rendertron deployed to herkou',
    // })

    const workQueue = new sqs.Queue(this, 'workQueue', {
      visibilityTimeout: Duration.minutes(3), // same as worker
    })

    const largeMemoryQueue = new sqs.Queue(this, 'LargeMemoryWorkQueue', {
      visibilityTimeout: Duration.minutes(5),
    })

    const workTopic = new sns.Topic(this, 'workTopic', {
    })

    const largeMemoryTopic = new sns.Topic(this, 'LargeMemoryWorkTopic', {
    })


    // keep outside of this dir, had issues with symlinks breaking the upload...
    const refresherLambda = new lambda.Function(this, 'refresher', {
      code: new lambda.AssetCode(CODE_BASE + 'refresher'),
      handler: 'refresher.handler',
      runtime: RUNTIME,
      architecture: ARCH,
      timeout: Duration.minutes(3),
      // memorySize: 1024,
      environment: {
        QueueUrl: workQueue.queueUrl,
        LargeMemoryQueueUrl: largeMemoryQueue.queueUrl,
        SNSArn: workTopic.topicArn,
        LargeMemorySNSArn: largeMemoryTopic.topicArn,
        NODE_ENV,
        STAGE,
        DONT_LOG_CONSOLE,
        REGION
      },
      logRetention: RetentionDays.ONE_MONTH,
      description: 'invoked by cloudwatch scheduled event to trigger all the of the scrape tasks'
    })


    const refreshCron = new events.Rule(this, 'referesher', {
      description: 'refresh all prices in dynamo',
      schedule: events.Schedule.rate(Duration.hours(REFRESH_HOURS)),
      enabled: is_prod_enabled // don't run the full cron schedule for beta (todo: have refresher only do a small subset)
    })
    refresherLambda.addEventSource(new CloudwatchScheduleEvent(refreshCron))


    workQueue.grantSendMessages(refresherLambda)
    largeMemoryQueue.grantSendMessages(refresherLambda)
    workTopic.grantPublish(refresherLambda)
    largeMemoryTopic.grantPublish(refresherLambda)

    const workerCode = new lambda.AssetCode(CODE_BASE + 'worker')
    const workerLambda = this.generateWorker('worker', {
      TABLE_NAME,
      PRIMARY_KEY,
      NODE_ENV,
      STAGE,
      DONT_LOG_CONSOLE,
      REGION,
      'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
    }, workQueue, workTopic, Duration.minutes(3), workerCode, 1024)

    const largeMemoryWorkerLambda = this.generateWorker('largeMemoryWorker', {
      TABLE_NAME,
      PRIMARY_KEY,
      NODE_ENV,
      STAGE,
      DONT_LOG_CONSOLE,
      REGION,
      'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
    }, largeMemoryQueue, largeMemoryTopic, Duration.minutes(5), workerCode, 3008)

    // rendertronUrl.grantRead(workerLambda)
    itemsTable.grantWriteData(workerLambda)
    itemsTable.grantWriteData(largeMemoryWorkerLambda)

    // manually set the value of this secret once created
    const esUrlSecret = is_prod_enabled ?
      new Secret(this, 'esUrlSecret', {
        description: 'url with user + pass to send logs to. should be in the form https://user:password@example.com',
      }) : null

    const logExporter = new lambda.Function(this, 'logExporter', {
      code: new lambda.AssetCode('./dist/lambdas/log-exporter'),
      handler: 'index.handler',
      runtime: RUNTIME,
      architecture: ARCH,
      timeout: Duration.minutes(2),
      memorySize: 128,
      environment: {
        NODE_ENV,
        STAGE,
        DONT_LOG_CONSOLE,
        REGION,
        ES_URL_SECRET_ID: esUrlSecret?.secretArn || ''
      },
      logRetention: RetentionDays.THREE_DAYS,
      description: 'moves logs from cloudwatch to elasticsearch'
    })
    if (is_prod_enabled) {
      esUrlSecret?.grantRead(logExporter)
    }
    logExporter.grantInvoke(new iam.ServicePrincipal(`logs.amazonaws.com`, {}))

    const testLambda = new lambda.Function(this, 'testLambda', {
      functionName: TEST_LAMBDA_NAME,
      runtime: RUNTIME,
      architecture: ARCH,
      timeout: Duration.minutes(2),
      code: new lambda.AssetCode(CODE_BASE + 'test'),
      handler: 'test.handler',
      logRetention: LOG_RETENTION,
      description: 'runs series of integ tests to make sure that nothing broke in the latest deployment'
    });

    [
      workerLambda,
      largeMemoryWorkerLambda,
      refresherLambda,
      api.lambda,
      api.graphqlLambda,
      testLambda
    ].forEach(l => exportLambdaLogsToLogger(this, l, logExporter))


    if (props.email) {
      const emailMe = new Topic(this, 'emailMeTopic')

      emailMe.addSubscription(new EmailSubscription(props.email))
      // alarms
      const al5xx = new Alarm(this, 'api5xxErrors', {
        datapointsToAlarm: 5,
        evaluationPeriods: 5,
        metric: new Metric({
          metricName: '5XXError',
          namespace: 'AWS/ApiGateway',
          statistic: 'Sum',
          region: this.region,
          period: Duration.minutes(5),
          dimensionsMap: {
            ApiName: apiName
          }
        }),
        treatMissingData: TreatMissingData.NOT_BREACHING,
        threshold: 5,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD
      })

      al5xx.addAlarmAction(new SnsAction(emailMe))

      const al4xx = new Alarm(this, 'api4xxErrors', {
        datapointsToAlarm: 5,
        evaluationPeriods: 5,
        metric: new Metric({
          metricName: '4XXError',
          namespace: 'AWS/ApiGateway',
          statistic: 'Sum',
          region: this.region,
          period: Duration.minutes(5),
          dimensionsMap: {
            ApiName: apiName
          }
        }),
        treatMissingData: TreatMissingData.NOT_BREACHING,
        threshold: 15,
        comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD
      })

      al4xx.addAlarmAction(new SnsAction(emailMe))

      // only alarm on low traffic on prod....
      // api gateway gets no traffic after moving to fly.io
      if (is_prod_enabled && 1 > 99) {
        // alarms
        const lowTrafficAlarm = new Alarm(this, 'lowTrafficApi', {
          datapointsToAlarm: 6,
          evaluationPeriods: 6,
          metric: new Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            region: this.region,
            statistic: 'Sum',
            period: Duration.minutes(10),
            dimensionsMap: {
              ApiName: apiName
            }
          }),
          treatMissingData: TreatMissingData.BREACHING,
          threshold: 1,
          comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD
        })

        lowTrafficAlarm.addAlarmAction(new SnsAction(emailMe))
      }
    }


  }

  private generateWorker(name: string, environment: { [k: string]: string }, queue: sqs.IQueue, topic: sns.Topic, timeout: Duration, code: lambda.Code, memorySize: number): lambda.Function {

    const workerLambda = new lambda.Function(this, name, {
      code,
      handler: 'worker.handler',
      runtime: RUNTIME,
//      architecture: ARCH, TODO    
      timeout,
      memorySize,
      environment,
      logRetention: LOG_RETENTION,
      description: 'listens to queue of scrape tasks and performs a search and stores the result in the db',
      layers: [
        //https://github.com/shelfio/chrome-aws-lambda-layer
        lambda.LayerVersion.fromLayerVersionArn(this, name + 'shelfio_chrome-aws-lambda-layer',
          `arn:aws:lambda:${this.region}:764866452798:layer:chrome-aws-lambda:31`)
      ],
      retryAttempts: 0,
    })
    workerLambda.addEventSource(new SqsEventSource(queue))
    workerLambda.addEventSource(new SnsEventSource(topic))
    queue.grantConsumeMessages(workerLambda)

    return workerLambda
  }
}
