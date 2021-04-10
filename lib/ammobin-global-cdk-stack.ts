import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import lambda = require('@aws-cdk/aws-lambda')
import iam = require('@aws-cdk/aws-iam')
import { LOG_RETENTION, Stage, REFRESH_HOURS, Region } from './constants'
import { Duration } from '@aws-cdk/core'
import { Alarm, Metric, ComparisonOperator, TreatMissingData } from '@aws-cdk/aws-cloudwatch'
import { SnsAction } from '@aws-cdk/aws-cloudwatch-actions'
import { Topic, } from '@aws-cdk/aws-sns'
import { EmailSubscription } from '@aws-cdk/aws-sns-subscriptions'
import { PolicyStatement, CanonicalUserPrincipal } from '@aws-cdk/aws-iam'
import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')

import sha256 = require('sha256-file')


interface IAmmobinGlobalCdkStackProps extends cdk.StackProps {
  publicUrl: string,
  siteBucket: string,
  stage: Stage,
  region: Region,
  email?: string
}

export class AmmobinGlobalCdkStack extends cdk.Stack {
  cert: acm.Certificate
  nuxtRerouter: lambda.Function
  nuxtRerouterVersion: lambda.Version

  constructor(scope: cdk.App, id: string, props: IAmmobinGlobalCdkStackProps) {
    super(scope, id, props)



    this.cert = new acm.Certificate(this, 'RootGlobalCert', {
      domainName: props.publicUrl,
      validationMethod: acm.ValidationMethod.DNS,
    })
    new cdk.CfnOutput(this, 'mainCert', { value: this.cert.certificateArn })

    const apiCode = new lambda.AssetCode('dist/lambdas/edge')
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
      managedPolicies: [
        // need to add this back in so we can write logs
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    })
    // https://github.com/bogdal/aws-cdk-website/blob/master/src/SinglePageApplication.ts#L57
    const nuxtRerouter = new lambda.Function(this, 'nuxtRerouter', {
      code: apiCode,
      handler: 'nuxt-rerouter.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      environment: {},
      timeout: Duration.seconds(3),
      role: lambdaRole,
      logRetention: LOG_RETENTION,
      description: ''
    }) //.addPermission()

    const securityHeaders = new lambda.Function(this, 'securityHeaders', {
      code: apiCode,
      handler: 'security-headers.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      environment: {},
      timeout: Duration.seconds(3),
      role: lambdaRole,
      logRetention: LOG_RETENTION
    })

    new cdk.CfnOutput(this, 'nuxtRerouterArn', { value: nuxtRerouter.functionArn })

    // this way it updates version only in case lambda code changes
    // version has to start with a letter
    const nuxtRerouterVersion = new lambda.Version(this, 'V' + sha256('lambdas/edge/nuxt-rerouter.ts'), {
      lambda: nuxtRerouter,
    })
    const securityHeadersVersion = new lambda.Version(this, 'V' + sha256('lambdas/edge/security-headers.ts'), {
      lambda: securityHeaders,
    })

    this.nuxtRerouterVersion = nuxtRerouterVersion

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'siteBucketAccess', {
      comment: 'let cloudfront access the site bucket'
    })

    // todo: delete this bucket if/when github page alternative is confirmed working
    // Content bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: props.siteBucket,
      publicReadAccess: false,
    })
    siteBucket.addLifecycleRule({ expiration: Duration.days(30) })
    new cdk.CfnOutput(this, 'siteBucket', { value: siteBucket.bucketName })

    new s3.BucketPolicy(this, "BucketPolicy", {
      bucket: siteBucket,
    }).document.addStatements(new PolicyStatement({
      actions: ['s3:GetObject'],
      principals: [new CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
      resources: ["arn:aws:s3:::" + siteBucket.bucketName + "/*"]
    }))

    const use_github_site = props.stage === 'prod' //&& props.region === 'CA'

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
      aliasConfiguration: {
        // from output of ammobin global cdk stack in us-east-1...
        // todo: make this cleaner + other people can use
        acmCertRef: this.cert.certificateArn,
        names: [props.publicUrl],
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2019,
      },
      enableIpV6: true,
      comment: 'main domain for ammobin, hosts both assets and api',
      httpVersion: cloudfront.HttpVersion.HTTP2,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      errorConfigurations: [
        {
          errorCode: 403,
          responseCode: 403,
          responsePagePath: '/200.html',
          errorCachingMinTtl: 60 * 5 // 5mins
        },
        {
          errorCode: 404,
          responseCode: 404,
          responsePagePath: '/200.html',
          errorCachingMinTtl: 60 * 30 // 30mins
        }
      ],
      originConfigs: [
        {
          // 20200105 due to high cost + volume of PUT requests to s3 site bucket, use github pages instead for production
          s3OriginSource: !(use_github_site) ? {
            s3BucketSource: siteBucket,
            originAccessIdentity
          } : undefined,
          customOriginSource: use_github_site ? {
            // see https://github.com/ammobinDOTca/s3-bucket
            domainName: `client.github.ammobin.${props.region.toLowerCase()}`
          } : undefined,
          behaviors: [
            {
              lambdaFunctionAssociations: [
                {
                  eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
                  lambdaFunction: nuxtRerouterVersion,
                },
                {
                  eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
                  lambdaFunction: securityHeadersVersion
                },
              ],
              forwardedValues: {
                queryString: true, // need to be able to redirect old urls to new ones
              },
              isDefaultBehavior: true,
              defaultTtl: Duration.days(365),
              minTtl: Duration.days(REFRESH_HOURS / 24), // want to make sure that updated pages get sent (refreshing once a day now)
            },
          ],
        },
        {
          // 20200105 due to high cost + volume of PUT requests to s3 site bucket, use github pages instead for production
          s3OriginSource: !use_github_site ? {
            s3BucketSource: siteBucket,
            originAccessIdentity
          } : undefined,
          customOriginSource: use_github_site ? {
            // see https://github.com/ammobinDOTca/s3-bucket
            domainName: `client.github.ammobin.${props.region.toLowerCase()}`
          } : undefined,
          behaviors: [
            {
              pathPattern: '_nuxt/*',
              defaultTtl: Duration.days(365),
              minTtl: Duration.days(365),
            },
          ],
        },
        // route api requests to the api lambda + gateway
        {
          customOriginSource: {
            domainName: 'api.' + props.publicUrl
          },
          behaviors: [
            {
              isDefaultBehavior: false,
              pathPattern: 'api/*',
              forwardedValues: {
                queryString: true,
              },
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
              cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD_OPTIONS,
              defaultTtl: Duration.days(REFRESH_HOURS / 24),
              minTtl: Duration.minutes(30),
            },
          ],
        },
        // image proxy, cache for a year...
        {
          customOriginSource: {
            domainName: 'images.' + props.publicUrl
          },
          behaviors: [
            {
              isDefaultBehavior: false,
              pathPattern: 'images/*',
              allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
              cachedMethods: cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD,
              defaultTtl: Duration.days(365),
              minTtl: Duration.days(365),
            },
          ],
        },
      ],
    })


    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId })

    // the main magic to easily pass the lambda version to stack in another region
    new cdk.CfnOutput(this, 'nuxtRerouterArnWithVersion', {
      value: cdk.Fn.join(':', [nuxtRerouter.functionArn, nuxtRerouterVersion.version]),
    })

    if (props.email) {
      const emailMe = new Topic(this, 'emailMeTopic')

      emailMe.addSubscription(new EmailSubscription(props.email))

      // only alarm on low traffic on prod....
      if (props.stage === 'prod') {
        // alarms
        const lowTrafficAlarm = new Alarm(this, 'lowTrafficCloudFront', {
          datapointsToAlarm: 5,
          evaluationPeriods: 5,
          metric: new Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'Requests',
            region: this.region,
            statistic: 'sum',
            period: Duration.minutes(5),
            dimensions: {
              DistributionId: distribution.distributionId,
              Region: 'Global'
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
}
