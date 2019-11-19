import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import lambda = require('@aws-cdk/aws-lambda')
import iam = require('@aws-cdk/aws-iam')
import { PUBLIC_URL, API_URL, LOG_RETENTION } from './constants'
import { Duration } from '@aws-cdk/core'
import apigateway = require('@aws-cdk/aws-apigateway')

import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
import s3deploy = require('@aws-cdk/aws-s3-deployment')
import sha256 = require('sha256-file')
import { PolicyStatement, CanonicalUserPrincipal } from '@aws-cdk/aws-iam'

export class AmmobinGlobalCdkStack extends cdk.Stack {
  cert: acm.Certificate
  nuxtRerouter: lambda.Function
  nuxtRerouterVersion: lambda.Version

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    this.cert = new acm.Certificate(this, 'RootGlobalCert', {
      domainName: PUBLIC_URL,
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

    const secruityHeaders = new lambda.Function(this, 'securityHeaders', {
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
    const secruityHeadersVersion = new lambda.Version(this, 'V' + sha256('edge-lambdas/security-headers.ts'), {
      lambda: secruityHeaders,
    })
    this.nuxtRerouterVersion = nuxtRerouterVersion

    const cfIdentityResource = new cloudfront.CfnCloudFrontOriginAccessIdentity(this, 'siteBucketAccess', {
      cloudFrontOriginAccessIdentityConfig: {
        comment: 'let cloudfront access the site bucket'
      }
    })

    // Content bucket
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: 'ammobin-aws-site', // todo: this needs to be set by cdk for this stack to be deployed more than once
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '200.html',
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
      // the new bucket, and it will remain in your account until manually deleted. By setting the policy to
      // DESTROY, cdk destroy will attempt to delete the bucket, but will error if the bucket is not empty.
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    })
    new cdk.CfnOutput(this, 'Bucket', { value: siteBucket.bucketName })

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
        names: [PUBLIC_URL],
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016,
      },
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
                  lambdaFunction: secruityHeadersVersion
                }
              ],
              isDefaultBehavior: true,
              defaultTtl: Duration.days(365)
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
              defaultTtl: Duration.days(365)
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
              allowedMethods: cloudfront.CloudFrontAllowedMethods.ALL
            },
          ],
        },
      ],
    })
    // new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
    //   sources: [s3deploy.Source.asset('./site-contents')],
    //   destinationBucket: siteBucket,
    //   distribution,
    //   // distributionPaths: ['/*'],
    // })

    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId })

    // the main magic to easily pass the lambda version to stack in another region
    new cdk.CfnOutput(this, 'nuxtRerouterArnWithVersion', {
      value: cdk.Fn.join(':', [nuxtRerouter.functionArn, nuxtRerouterVersion.version]),
    })
  }
}
