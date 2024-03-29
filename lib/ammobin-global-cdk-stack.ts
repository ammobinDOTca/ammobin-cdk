import cdk = require('aws-cdk-lib')
import acm = require('aws-cdk-lib/aws-certificatemanager')
import lambda = require('aws-cdk-lib/aws-lambda')
import iam = require('aws-cdk-lib/aws-iam')
import { LOG_RETENTION, Stage, REFRESH_HOURS, Region, RUNTIME } from './constants'
import { Duration } from 'aws-cdk-lib'
import { Alarm, Metric, ComparisonOperator, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch'
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions'
import { Topic, } from 'aws-cdk-lib/aws-sns'
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions'
import { PolicyStatement, CanonicalUserPrincipal, PolicyDocument, Effect } from 'aws-cdk-lib/aws-iam'
import s3 = require('aws-cdk-lib/aws-s3')
import cloudfront = require('aws-cdk-lib/aws-cloudfront')

import sha256 = require('sha256-file')
import { FunctionEventType, LambdaEdgeEventType, SecurityPolicyProtocol, ViewerCertificate } from 'aws-cdk-lib/aws-cloudfront'
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import { regionToAWSRegion } from './helper'


interface IAmmobinGlobalCdkStackProps extends cdk.StackProps {
  publicUrl: string,
  stage: Stage,
  region: Region,
  email?: string,
  imageFunctionUrl?: string,
  apiFunctionUrl?: string,
  graphqlFunctionUrl?: string,
}

export class AmmobinGlobalCdkStack extends cdk.Stack {
  cert: acm.Certificate

  constructor(scope: cdk.App, id: string, props: IAmmobinGlobalCdkStackProps) {
    super(scope, id, props)



    this.cert = new acm.Certificate(this, 'RootGlobalCert', {
      domainName: props.publicUrl,
      validation: CertificateValidation.fromDns(),
      subjectAlternativeNames: props.stage.toLowerCase() === 'prod' ? ['www.' + props.publicUrl] : []
    })
    new cdk.CfnOutput(this, 'mainCert', { value: this.cert.certificateArn })


    const signerRole = new iam.Role(this, 'LambdaSignerExecutionRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
      managedPolicies: [
        // need to add this back in so we can write logs
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        invokeUrl: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['lambda:InvokeFunctionUrl'],
              resources: [`arn:aws:lambda:${regionToAWSRegion(props.region)}:${this.account}:function:*`]
            })
          ]
        })
      }
    })


    const edgeSigner = new lambda.Function(this, 'edgeSigner', {
      code: new lambda.AssetCode('dist/lambdas/edge-signer'),
      handler: 'index.handler',
      runtime: RUNTIME,
      //      architecture: ARCH, todo: not supported yet
      environment: {},
      timeout: Duration.seconds(3),
      role: signerRole,
      logRetention: LOG_RETENTION,
      description: ''
    })

    const edgeSignerVersion = new lambda.Version(this, 'V' + sha256('lambdas/edge-signer/index.ts') + sha256('lambdas/edge-signer/package-lock.json'), {
      lambda: edgeSigner,
    })


    const cfWorker = "ammobin-new.s3ramsay.workers.dev" // todo: restore ? `ammobin_nuxt_${props.region.toLowerCase()}_${props.stage.toLowerCase()}.ammobin.workers.dev`

    const distribution =
      new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
        // todo: replace edge lambda with cloudfront custom header functionality once in CDK
        defaultRootObject: '', // cloudflare handles this internally for us
        // from output of ammobin global cdk stack in us-east-1...
        // todo: make this cleaner + other people can use

        viewerCertificate: ViewerCertificate.fromAcmCertificate(Certificate.fromCertificateArn(this, 'viewCert', this.cert.certificateArn), {
          aliases: [props.publicUrl],
          securityPolicy: SecurityPolicyProtocol.TLS_V1_2_2021,
        }),
        enableIpV6: true,
        comment: 'main domain for ammobin, hosts both assets and api',
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        errorConfigurations: [
          // TODO: fix this? cloudflare is breaking on 404, and sending back their error page
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
          },
        ],
        originConfigs: [
          {
            customOriginSource: {
              domainName: cfWorker,
            },
            // todo: add old generated client as fallback?
            behaviors: [
              {
                functionAssociations: [{
                  eventType: FunctionEventType.VIEWER_RESPONSE,
                  function: new cloudfront.Function(this, 'Function', {
                    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
    var response = event.response;
    var headers = response.headers;

    // Set HTTP security headers
    headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubdomains; preload'};
    headers['content-security-policy-report-only'] = { value: "default-src 'self';script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://storage.googleapis.com; connect-src  'self';  style-src 'self' 'unsafe-inline';img-src 'self' https://store-udt1amkaxd.mybigcommerce.com; report-uri https://ammobin.ca/api/content-security-report-uri" };
    headers['x-content-type-options'] = { value: 'nosniff'};
    headers['x-frame-options'] = {value: 'DENY'};
    headers['x-xss-protection'] = {value: '1; mode=block'};

    delete headers['server']
    delete headers['cf-ray']
    delete headers['nel']
    delete headers['report-to']


    // Return the response to viewers
    return response;
                    }`),
                  })
                }],
                forwardedValues: {
                  queryString: true, // will be bringing back query params
                },
                isDefaultBehavior: true,
                compress: true,
                maxTtl: Duration.days(1),
                defaultTtl: Duration.hours(4),
                minTtl: Duration.hours(1), // want to make sure that updated pages get sent (refreshing once a day now)
              },
            ],
          },
          {
            // enforce much higher TTL on webassets from worker to keep down uneeded traffic
            customOriginSource: {
              domainName: cfWorker
            },
            behaviors: [
              {
                pathPattern: '_nuxt/*',
                defaultTtl: Duration.days(365),
                minTtl: Duration.days(365),
                compress: true,
              },
            ],
          },
          // graphql lambda
          {
            customOriginSource: {
              domainName: props.graphqlFunctionUrl ?
                props.graphqlFunctionUrl :
                'api.' + props.publicUrl
            },
            behaviors: [
              {
                isDefaultBehavior: false,
                pathPattern: 'api/graphql*',
                lambdaFunctionAssociations: props.graphqlFunctionUrl ? [
                  {
                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                    lambdaFunction: edgeSignerVersion,
                    includeBody: true
                  }
                ] : undefined,
                forwardedValues: {
                  queryString: true,
                  headers: [
                    'User-Agent',
                    'CloudFront-Is-Mobile-Viewer',
                    'CloudFront-Is-Desktop-Viewer',
                    'CloudFront-Viewer-Country',
                    'CloudFront-Viewer-Country-Region-Name',
                    'CloudFront-Viewer-Postal-Code',
                    'CloudFront-Viewer-Time-Zone'
                  ],
                },
                allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
                defaultTtl: Duration.days(REFRESH_HOURS / 24),
                minTtl: Duration.minutes(30),
                compress: true
              },
            ]
          },
          // route api requests to the api lambda + gateway
          {
            customOriginSource: {
              domainName: props.apiFunctionUrl ?
                props.apiFunctionUrl :
                'api.' + props.publicUrl
            },
            behaviors: [
              {
                isDefaultBehavior: false,
                pathPattern: 'api/ping',
                lambdaFunctionAssociations: props.apiFunctionUrl ? [
                  {
                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                    lambdaFunction: edgeSignerVersion,
                  }
                ] : undefined,
                forwardedValues: {
                  queryString: false,
                  headers: [
                    'User-Agent',
                    'CloudFront-Is-Mobile-Viewer',
                    'CloudFront-Is-Desktop-Viewer',
                    'CloudFront-Viewer-Country',
                    'CloudFront-Viewer-Country-Region-Name',
                    'CloudFront-Viewer-Postal-Code',
                    'CloudFront-Viewer-Time-Zone'
                  ],
                },
                allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
                defaultTtl: Duration.days(0),
                maxTtl: Duration.days(0),
                minTtl: Duration.minutes(0),
              },
              {
                isDefaultBehavior: false,
                pathPattern: 'api/*',
                lambdaFunctionAssociations: props.apiFunctionUrl ? [
                  {
                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                    lambdaFunction: edgeSignerVersion,
                    includeBody: true
                  }
                ] : undefined,
                forwardedValues: {
                  queryString: true,
                  headers: [
                    'User-Agent',
                    'CloudFront-Is-Mobile-Viewer',
                    'CloudFront-Is-Desktop-Viewer',
                    'CloudFront-Viewer-Country',
                    'CloudFront-Viewer-Country-Region-Name',
                    'CloudFront-Viewer-Postal-Code',
                    'CloudFront-Viewer-Time-Zone'
                  ],
                },
                allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL,
                defaultTtl: Duration.days(REFRESH_HOURS / 24),
                minTtl: Duration.minutes(30),
                compress: true
              },
            ],


          },

          // image proxy, cache for a year...
          {
            customOriginSource: {
              domainName: props.imageFunctionUrl ?
                props.imageFunctionUrl :
                'images.' + props.publicUrl
            },
            behaviors: [
              {
                lambdaFunctionAssociations: props.imageFunctionUrl ? [
                  {
                    eventType: LambdaEdgeEventType.ORIGIN_REQUEST,
                    lambdaFunction: edgeSignerVersion
                  }
                ] : undefined,
                isDefaultBehavior: false,
                compress: true,
                pathPattern: 'images/*',
                allowedMethods: cloudfront.CloudFrontAllowedMethods.GET_HEAD,
                defaultTtl: Duration.days(365),
                minTtl: Duration.days(365),
              },
            ],

          },
        ],
      })
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId })


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
            dimensionsMap: {
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
