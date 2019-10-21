import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
import acm = require('@aws-cdk/aws-certificatemanager')
import dynamodb = require('@aws-cdk/aws-dynamodb')
import sqs = require('@aws-cdk/aws-sqs')
import { SqsEventSource } from '@aws-cdk/aws-lambda-event-sources'
import { AmmobinApiStack } from './ammobin-api-stack'
import { API_URL, CLIENT_URL, PUBLIC_URL } from './constants'
import { Duration } from '@aws-cdk/core'

import sm = require('@aws-cdk/aws-secretsmanager')

interface ASS extends cdk.StackProps {
  // edgeLambdaArn: string
  // edgeLamda: lambda.Function
  edgeLamdaVersion: lambda.IVersion
}

export class AmmobinCdkStack extends cdk.Stack {
  edgeLambdaArn: string
  edgeLamda: lambda.Function
  edgeLamdaVersion: lambda.IVersion
  // todo: type props
  constructor(scope: cdk.App, id: string, props: ASS) {
    super(scope, id, props)
    console.log(props)

    const itemsTable = new dynamodb.Table(this, 'table', {
      tableName: 'ammobinItems',
      partitionKey: {
        name: 'id',
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
        NODE_ENV: 'production',
      },
      timeout: Duration.seconds(30),
    })

    const api = new AmmobinApiStack(this, 'ammobin-api', {
      handler: 'dist/api/lambda.handler',
      name: 'apiLambda',
      src: 'src/ammobin-api',
      url: API_URL,
      environment: {
        TABLE_NAME: itemsTable.tableName,
        PRIMARY_KEY: 'id',
        //NODE_ENV: 'production', (nice to leave api playground open...)
      },
    })
    // typescript bug?
    itemsTable.grantReadData(api.lambda)

    // Content bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
    })
    new cdk.CfnOutput(this, 'StaticBucket', { value: siteBucket.bucketName })

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
      // TODO: manually create this cert in us-east-1 OR use separate stack...
      aliasConfiguration: {
        // from output of ammobin global cdk stack in us-east-1...
        // todo: make this cleaner + other people can use
        acmCertRef: 'arn:aws:acm:us-east-1:911856505652:certificate/c47819c6-fcaf-46e5-aef6-9167413156b8',
        names: [PUBLIC_URL],
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
      },
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: siteBucket,
            // had to manually override to be sub folder (code build does not output propeerly
          },
          behaviors: [
            {
              lambdaFunctionAssociations: [
                {
                  eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                  lambdaFunction: props.edgeLamdaVersion,
                },
              ],
              isDefaultBehavior: true,
              // pathPattern: '_nuxt/*',
            },
          ],

          //originPath:/codeBuildFolder???
        },
        // {
        //   customOriginSource: {
        //     domainName: CLIENT_URL,
        //   },
        //   behaviors: [
        //     {
        //       // isDefaultBehavior: true,
        //       allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
        //     },
        //   ],
        // },
        // route api requests to the api lambda + gateway
        {
          customOriginSource: {
            domainName: API_URL,
          },
          behaviors: [
            {
              isDefaultBehavior: false,
              pathPattern: 'api/*',
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
            },
          ],
        },
      ],
    })
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId })

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
      },
    })
    // todo: run this every so often cloudwatch schedule events

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
        TABLE_NAME: itemsTable.tableName,
        PRIMARY_KEY: 'id',
      },
    })
    workerLambda.addEventSource(new SqsEventSource(workQueue))

    rendertronUrl.grantRead(workerLambda)
    itemsTable.grantWriteData(workerLambda)
    //workQueue.grantConsumeMessages(workerLambda)

    //QueueUrl
  }
}
