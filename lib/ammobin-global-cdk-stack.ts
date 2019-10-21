import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import lambda = require('@aws-cdk/aws-lambda')
import iam = require('@aws-cdk/aws-iam')
import { PUBLIC_URL } from './constants'
import { Duration } from '@aws-cdk/core'
import sha256 = require('sha256-file')

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
    const nuxtRerouter = new lambda.Function(this, 'nuxtRerouter', {
      code: apiCode,
      handler: 'nuxt-rerouter.handler',
      runtime: lambda.Runtime.NODEJS_8_10,
      environment: {},
      timeout: Duration.seconds(3),
      role: new iam.Role(this, 'AllowLambdaServiceToAssumeRole', {
        assumedBy: new iam.CompositePrincipal(
          new iam.ServicePrincipal('lambda.amazonaws.com'),
          new iam.ServicePrincipal('edgelambda.amazonaws.com')
        ),
        //managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
      }),
    })

    new cdk.CfnOutput(this, 'nuxtRerouterArn', { value: nuxtRerouter.functionArn })

    // this way it updates version only in case lambda code changes
    const version = nuxtRerouter.addVersion(':sha256:' + sha256('edge-lambdas/nuxt-rerouter.ts'))
    this.nuxtRerouterVersion = version

    // the main magic to easily pass the lambda version to stack in another region
    new cdk.CfnOutput(this, 'nuxtRerouterArnWithVersion', {
      value: cdk.Fn.join(':', [nuxtRerouter.functionArn, version.version]),
    })
  }
}
