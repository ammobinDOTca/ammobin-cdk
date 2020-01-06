import lambda = require('@aws-cdk/aws-lambda')
import cdk = require('@aws-cdk/core')
import dynamodb = require('@aws-cdk/aws-dynamodb')
import sqs = require('@aws-cdk/aws-sqs')
import { SqsEventSource, KinesisEventSource, StreamEventSource } from '@aws-cdk/aws-lambda-event-sources'
import { AmmobinApiStack } from './ammobin-api-stack'
import { LOG_RETENTION, Stage } from './constants'
import { Duration } from '@aws-cdk/core'
import events = require('@aws-cdk/aws-events')
import sm = require('@aws-cdk/aws-secretsmanager')
import { CloudwatchScheduleEvent } from './CloudWatchScheduleEvent'
import { RetentionDays } from '@aws-cdk/aws-logs'

import { exportLambdaLogsToLogger } from './helper'
import { Secret } from '@aws-cdk/aws-secretsmanager'

import { AmmobinImagesStack } from './ammobin-images-stack'

interface IAmmobinCdkStackProps extends cdk.StackProps {
  publicUrl: string,
  stage: Stage
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

    const itemsTable = new dynamodb.Table(this, 'table', {
      tableName: TABLE_NAME,
      partitionKey: {
        name: PRIMARY_KEY,
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    new AmmobinImagesStack(this, 'ammobinImages', { url: 'images.' + props.publicUrl, stage: props.stage })
    const CODE_BASE = '../ammobin-api/lambda/'

    const api = new AmmobinApiStack(this, 'ammobin-api', {
      name: 'apiLambda',
      CODE_BASE,
      url: 'api.' + props.publicUrl,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE,
        HASH_SECRET,
        STAGE,
      },
    })

    itemsTable.grantReadData(api.lambda)
    itemsTable.grantReadData(api.graphqlLambda)

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


    // keep outside of this dir, had issues with symlinks breaking the upload...
    const refresherLambda = new lambda.Function(this, 'refresher', {
      code: new lambda.AssetCode(CODE_BASE + 'refresher'),
      handler: 'refresher.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: Duration.minutes(3),
      // memorySize: 1024,
      environment: {
        QueueUrl: workQueue.queueUrl,
        LargeMemoryQueueUrl: largeMemoryQueue.queueUrl,
        NODE_ENV,
        STAGE,
        DONT_LOG_CONSOLE
      },
      logRetention: RetentionDays.ONE_MONTH,
      description: 'invoked by cloudwatch scheduled event to trigger all the of the scrape tasks'
    })

    // refresh once a day (UTC)
    const refreshCron = new events.Rule(this, 'referesher', {
      description: 'refresh all prices in dynamo',
      schedule: events.Schedule.cron({
        hour: '8',
        minute: '1',
      }),
      enabled: props.stage === 'prod' // don't run the full cron schedule for beta (todo: have refresher only do a small subset)
    })
    refresherLambda.addEventSource(new CloudwatchScheduleEvent(refreshCron))


    workQueue.grantSendMessages(refresherLambda)
    largeMemoryQueue.grantSendMessages(refresherLambda)

    const workerCode = new lambda.AssetCode(CODE_BASE + 'worker')
    const workerLambda = this.generateWorker('worker', {
      TABLE_NAME,
      PRIMARY_KEY,
      NODE_ENV,
      STAGE,
      DONT_LOG_CONSOLE,
      'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
    }, workQueue, Duration.minutes(3), workerCode, 1024)

    const largeMemoryWorkerLambda = this.generateWorker('largeMemoryWorker', {
      TABLE_NAME,
      PRIMARY_KEY,
      NODE_ENV,
      STAGE,
      DONT_LOG_CONSOLE,
      'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
    }, largeMemoryQueue, Duration.minutes(5), workerCode, 3008)

    // rendertronUrl.grantRead(workerLambda)
    itemsTable.grantWriteData(workerLambda)
    itemsTable.grantWriteData(largeMemoryWorkerLambda)

    // manually set the value of this secret once created
    const esUrlSecret = new Secret(this, 'esUrlSecret', {
      description: 'url with user + pass to send logs to',
    })

    const logExporter = new lambda.Function(this, 'logExporter', {
      code: new lambda.AssetCode('./dist/log-exporter'),
      handler: 'elasticsearch.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: Duration.minutes(5),
      memorySize: 128,
      environment: {
        NODE_ENV,
        STAGE,
        DONT_LOG_CONSOLE,
        ES_URL_SECRET_ID: esUrlSecret.secretArn
      },
      logRetention: LOG_RETENTION,
      description: 'moves logs from cloudwatch to elastic search'
    })
    esUrlSecret.grantRead(logExporter);

    [
      workerLambda,
      refresherLambda,
      api.lambda,
      api.graphqlLambda
    ].forEach(l => exportLambdaLogsToLogger(this, l, logExporter))

  }

  private generateWorker(name: string, environment: { [k: string]: string }, queue: sqs.IQueue, timeout: Duration, code: lambda.Code, memorySize: number): lambda.Function {

    const workerLambda = new lambda.Function(this, name, {
      code,
      handler: 'worker.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout,
      memorySize,
      environment,
      logRetention: LOG_RETENTION,
      description: 'listens to queue of scrape tasks and performs a search and stores the result in the db',
      layers: [
        //https://github.com/shelfio/chrome-aws-lambda-layer
        lambda.LayerVersion.fromLayerVersionArn(this, name + 'shelfio_chrome-aws-lambda-layer', 'arn:aws:lambda:ca-central-1:764866452798:layer:chrome-aws-lambda:8')
      ]
    })
    workerLambda.addEventSource(new SqsEventSource(queue))
    queue.grantConsumeMessages(workerLambda)

    return workerLambda
  }
}
