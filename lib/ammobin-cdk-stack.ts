import lambda = require('@aws-cdk/aws-lambda')
import cdk = require('@aws-cdk/core')
import dynamodb = require('@aws-cdk/aws-dynamodb')
import sqs = require('@aws-cdk/aws-sqs')
import { SqsEventSource, KinesisEventSource, StreamEventSource } from '@aws-cdk/aws-lambda-event-sources'
import { AmmobinApiStack } from './ammobin-api-stack'
import { LOG_RETENTION } from './constants'
import { Duration } from '@aws-cdk/core'
import events = require('@aws-cdk/aws-events')
import sm = require('@aws-cdk/aws-secretsmanager')
import { CloudwatchScheduleEvent } from './CloudWatchScheduleEvent'
import { RetentionDays } from '@aws-cdk/aws-logs'

import { exportLambdaLogsToLogger } from './helper'
import { Secret } from '@aws-cdk/aws-secretsmanager'

import { AmmobinImagesStack } from './ammobin-images-stack'

interface IAmmobinCdkStackProps extends cdk.StackProps {
  publicUrl: string
}

export class AmmobinCdkStack extends cdk.Stack {

  constructor(scope: cdk.App, id: string, props: IAmmobinCdkStackProps) {
    super(scope, id, props)

    const NODE_ENV = 'production'
    const DONT_LOG_CONSOLE = 'false'
    const PRIMARY_KEY = 'id'
    const TABLE_NAME = 'ammobinItems'
    const HASH_SECRET = 'TODO-REAL-SECRET' //

    const itemsTable = new dynamodb.Table(this, 'table', {
      tableName: TABLE_NAME,
      partitionKey: {
        name: PRIMARY_KEY,
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // todo: enable streams?
    })

    // new AmmobinApiStack(this, 'ammobin-client', {
    //   handler: 'lambda.nuxt',
    //   name: 'nuxtLambda',
    //   src: './src/ammobin-client-built',
    //   url: CLIENT_URL, // had trouble during development
    //   environment: {
    //     NODE_ENV,
    //     DONT_LOG_CONSOLE
    //   },
    //   timeout: Duration.seconds(30),
    // })


    new AmmobinImagesStack(this, 'ammobinImages', { url: 'images.' + props.publicUrl })

    const code = new lambda.AssetCode('../ammobin-api/lambda')

    const api = new AmmobinApiStack(this, 'ammobin-api', {
      handler: 'src/api/lambda.handler',
      name: 'apiLambda',
      code,
      url: 'api.' + props.publicUrl,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE,
        HASH_SECRET
      },
    })

    itemsTable.grantReadData(api.lambda)
    if (api.graphqlLambda) {
      itemsTable.grantReadData(api.graphqlLambda)
    }

    // TODO: manually update this key: https://ca-central-1.console.aws.amazon.com/secretsmanager/home?region=ca-central-1#/secret?name=rendertronUrl
    //https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_update-secret.html
    // note: not used currently b/c using internal pupeteer
    const rendertronUrl = new sm.Secret(this, 'rendertronUrl', {
      secretName: 'rendertronUrl',
      description: 'url to rendertron deployed to herkou',
    })

    const workQueue = new sqs.Queue(this, 'workQueue', {
      visibilityTimeout: Duration.minutes(3), // same as worker
    })
    // keep outside of this dir, had issues with symlinks breaking the upload...
    const refresherLambda = new lambda.Function(this, 'refresher', {
      code,
      handler: 'src/refresher/lambda.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      timeout: Duration.minutes(3),
      // memorySize: 1024,
      environment: {
        QueueUrl: workQueue.queueUrl,
        NODE_ENV,
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
      enabled: false // todo: re-enable once ready to go to prod
    })
    refresherLambda.addEventSource(new CloudwatchScheduleEvent(refreshCron))


    workQueue.grantSendMessages(refresherLambda)
    //todo: future opt -> 2 lambdas, high memory and low memory...
    // with 2 sqs queues
    const workerLambda = new lambda.Function(this, 'worker', {
      code,
      handler: 'src/worker/lambda.handler',
      runtime: lambda.Runtime.NODEJS_12_X, // as per https://github.com/alixaxel/chrome-aws-lambda
      timeout: Duration.minutes(3),
      memorySize: 1024,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE
      },
      logRetention: LOG_RETENTION,
      description: 'listens to queue of scrape tasks and performs a search and stores the result in the db'
    })
    workerLambda.addEventSource(new SqsEventSource(workQueue))

    rendertronUrl.grantRead(workerLambda)
    itemsTable.grantWriteData(workerLambda)
    workQueue.grantConsumeMessages(workerLambda)

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
        DONT_LOG_CONSOLE,
        ES_URL_SECRET_ID: esUrlSecret.secretArn
      },
      logRetention: LOG_RETENTION,
      description: 'listens to kinesis stream of all log messages, and forwards them to elastic search'
    })
    esUrlSecret.grantRead(logExporter);



    [
      workerLambda,
      refresherLambda,
      api.lambda,
      api.graphqlLambda as any
    ].forEach(l => exportLambdaLogsToLogger(this, l, logExporter))



  }
}
