import lambda = require('@aws-cdk/aws-lambda')
import cdk = require('@aws-cdk/core')
import dynamodb = require('@aws-cdk/aws-dynamodb')
import sqs = require('@aws-cdk/aws-sqs')
import { SqsEventSource } from '@aws-cdk/aws-lambda-event-sources'
import { AmmobinApiStack } from './ammobin-api-stack'
import { API_URL, CLIENT_URL } from './constants'
import { Duration } from '@aws-cdk/core'
import events = require('@aws-cdk/aws-events')

import sm = require('@aws-cdk/aws-secretsmanager')
import { CloudwatchScheduleEvent } from './CloudWatchScheduleEvent'

interface ASS extends cdk.StackProps {
  // edgeLambdaArn: string
  // edgeLamda: lambda.Function
  // edgeLamdaVersion: string //lambda.IVersion
  // edgeLamdaArn: string
}

export class AmmobinCdkStack extends cdk.Stack {
  // edgeLambdaArn: string
  // edgeLamda: lambda.Function
  // edgeLamdaVersion: lambda.IVersion
  // todo: type props
  constructor(scope: cdk.App, id: string, props: ASS) {
    super(scope, id, props)
    console.log(props)
    const NODE_ENV = 'production'
    const DONT_LOG_CONSOLE = 'true'
    const PRIMARY_KEY = 'id'
    const TABLE_NAME = 'ammobinItems'

    const itemsTable = new dynamodb.Table(this, 'table', {
      tableName: TABLE_NAME,
      partitionKey: {
        name: PRIMARY_KEY,
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // todo: enable streams?
    })

    new AmmobinApiStack(this, 'ammobin-client', {
      handler: 'lambda.nuxt',
      name: 'nuxtLambda',
      src: 'src/ammobin-client-built',
      url: CLIENT_URL, // had trouble during development
      environment: {
        NODE_ENV,
        DONT_LOG_CONSOLE
      },
      timeout: Duration.seconds(30),
    })

    const api = new AmmobinApiStack(this, 'ammobin-api', {
      handler: 'dist/api/lambda.handler',
      name: 'apiLambda',
      src: 'src/ammobin-api',
      url: API_URL,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE
      },
    })




    // typescript bug?
    itemsTable.grantReadData(api.lambda)
    if (api.graphqlLambda)
      itemsTable.grantReadData(api.graphqlLambda)

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

    const refresherLamdbaCode = new lambda.AssetCode('src/ammobin-api')
    const refresherLambda = new lambda.Function(this, 'refresher', {
      code: refresherLamdbaCode,
      handler: 'dist/refresher/lambda.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      timeout: Duration.minutes(3),
      // memorySize: 1024,
      environment: {
        QueueUrl: workQueue.queueUrl,
        NODE_ENV,
        DONT_LOG_CONSOLE
      },
    })

    // refresh once a day
    const refreshCron = new events.Rule(this, 'referesher', {
      description: 'refresh prices in dynamo',
      schedule: events.Schedule.cron({
        hour: '0',
        minute: '1',
      }),
      enabled: false // todo: re-enable once ready to go to prod
    })
    refresherLambda.addEventSource(new CloudwatchScheduleEvent(refreshCron))


    workQueue.grantSendMessages(refresherLambda)
    //todo: future opt -> 2 lambdas, high memeory and low memory...
    // with 2 sqs queues
    // question, why not sns with X cloudwatch
    const workerLamdbaCode = new lambda.AssetCode('src/ammobin-api')
    const workerLambda = new lambda.Function(this, 'worker', {
      code: workerLamdbaCode,
      handler: 'dist/worker/lambda.handler',
      runtime: lambda.Runtime.NODEJS_8_10, // as per https://github.com/alixaxel/chrome-aws-lambda
      timeout: Duration.minutes(3),
      memorySize: 1024,
      environment: {
        TABLE_NAME,
        PRIMARY_KEY,
        NODE_ENV,
        DONT_LOG_CONSOLE
      },
    })
    workerLambda.addEventSource(new SqsEventSource(workQueue))

    rendertronUrl.grantRead(workerLambda)
    itemsTable.grantWriteData(workerLambda)
    workQueue.grantConsumeMessages(workerLambda)

    //QueueUrl
  }
}
