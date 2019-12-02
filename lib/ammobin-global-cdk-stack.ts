import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import lambda = require('@aws-cdk/aws-lambda')
import iam = require('@aws-cdk/aws-iam')
import { LOG_RETENTION } from './constants'
import { Duration } from '@aws-cdk/core'

import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
import sha256 = require('sha256-file')
import { PolicyStatement, CanonicalUserPrincipal } from '@aws-cdk/aws-iam'

interface IAmmobinGlobalCdkStackProps extends cdk.StackProps {
  publicUrl: string,
  siteBucket: string
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

    const apiCode = new lambda.AssetCode('dist/edge-lambdas')
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
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {},
      timeout: Duration.seconds(3),
      role: lambdaRole,
      logRetention: LOG_RETENTION,
      description: ''
    }) //.addPermission()

    const securityHeaders = new lambda.Function(this, 'securityHeaders', {
      code: apiCode,
      handler: 'security-headers.handler',
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: {},
      timeout: Duration.seconds(3),
      role: lambdaRole,
      logRetention: LOG_RETENTION
    })

    new cdk.CfnOutput(this, 'nuxtRerouterArn', { value: nuxtRerouter.functionArn })

    // this way it updates version only in case lambda code changes
    // version has to start with a letter
    const nuxtRerouterVersion = new lambda.Version(this, 'V' + sha256('edge-lambdas/nuxt-rerouter.ts'), {
      lambda: nuxtRerouter,
    })
    const securityHeadersVersion = new lambda.Version(this, 'V' + sha256('edge-lambdas/security-headers.ts'), {
      lambda: securityHeaders,
    })
    this.nuxtRerouterVersion = nuxtRerouterVersion

    const cfIdentityResource = new cloudfront.CfnCloudFrontOriginAccessIdentity(this, 'siteBucketAccess', {
      cloudFrontOriginAccessIdentityConfig: {
        comment: 'let cloudfront access the site bucket'
      }
    })

    // Content bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: props.siteBucket,
      publicReadAccess: false,
    })
    new cdk.CfnOutput(this, 'siteBucket', { value: siteBucket.bucketName })

    new s3.BucketPolicy(this, "BucketPolicy", {
      bucket: siteBucket,
    }).document.addStatements(new PolicyStatement({
      actions: ['s3:GetObject'],
      principals: [new CanonicalUserPrincipal(cfIdentityResource.attrS3CanonicalUserId)],
      resources: ["arn:aws:s3:::" + siteBucket.bucketName + "/*"]
    }))

    const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
      aliasConfiguration: {
        // from output of ammobin global cdk stack in us-east-1...
        // todo: make this cleaner + other people can use
        acmCertRef: this.cert.certificateArn,
        names: [props.publicUrl],
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
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
          s3OriginSource: {
            s3BucketSource: siteBucket,
            originAccessIdentityId: cfIdentityResource.ref
          },
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
                }
              ],
              isDefaultBehavior: true,
              defaultTtl: Duration.days(365),
              minTtl: Duration.days(1), // want to make sure that updated pages get sent (refreshing once a day now)
            },
          ],
        },
        {
          // save a few pennies by not running edge lambda for most of the static assets
          s3OriginSource: {
            s3BucketSource: siteBucket,
            originAccessIdentityId: cfIdentityResource.ref
          },
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
              defaultTtl: Duration.days(365),
              minTtl: Duration.days(1), // incase we ever move to GETs for graphql requests....
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
  }
}
