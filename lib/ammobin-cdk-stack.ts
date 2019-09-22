import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
import acm = require('@aws-cdk/aws-certificatemanager')
import dynamodb = require('@aws-cdk/aws-dynamodb')

import { AmmobinApiStack } from './ammobin-api-stack'
import { API_URL, CLIENT_URL, PUBLIC_URL } from './constants'
import { Duration } from '@aws-cdk/core'
export class AmmobinCdkStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    new AmmobinApiStack(this, 'ammobin-client', {
      handler: 'lambda.nuxt',
      name: 'nuxtLambda',
      src: 'src/ammobin-client-built',
      url: CLIENT_URL, // had trouble during development
    })

    const f = new AmmobinApiStack(this, 'ammobin-api', {
      handler: 'dist/api/lambda.handler',
      name: 'apiLambda',
      src: 'src/ammobin-api',
      url: API_URL,
    })

    // Content bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
    })
    new cdk.CfnOutput(this, 'StaticBucket', { value: siteBucket.bucketName })

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
      // TODO: manually create this cert in us-east-1 OR use separate stack...
      // aliasConfiguration: {
      //   acmCertRef: new acm.Certificate(this, 'mainCert', {
      //     domainName: PUBLIC_URL,
      //     validationMethod: acm.ValidationMethod.DNS,
      //   }).certificateArn,
      //   names: [PUBLIC_URL],
      //   sslMethod: cloudfront.SSLMethod.SNI,
      //   securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
      // },
      originConfigs: [
        // default proxy is for nuxt (to handle home page routing)
        {
          customOriginSource: {
            domainName: CLIENT_URL,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
            },
          ],
        },
        // route requests for static assets to s3 bucket (where things have to be uploaded to outside of cdk deploy)
        {
          s3OriginSource: {
            s3BucketSource: siteBucket,
          },
          behaviors: [
            {
              isDefaultBehavior: false,
              pathPattern: '_nuxt/*',
            },
          ],
        },
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

    // 20190922 BUG , type miss match...
    const itemsTable = new dynamodb.Table(this as any, 'table', {
      tableName: 'ammobinItems',
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    })

    // todo: future opt -> 2 lambdas, high memeory and low memory...
    // with 2 sqs queues
    // question, why not sns with X cloudwatch
    const workerLamdbaCode = new lambda.AssetCode('src/ammobin-api')
    const workerLambda = new lambda.Function(this, 'worker', {
      code: workerLamdbaCode,
      handler: 'dist/worker/lambda.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      timeout: Duration.minutes(3),
      memorySize: 1024,
      environment: {
        TABLE_NAME: itemsTable.tableName,
        PRIMARY_KEY: 'id',
      },
    })
    itemsTable.grantWriteData(workerLambda as any)
  }
}
