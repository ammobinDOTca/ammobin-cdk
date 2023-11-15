import lambda = require('aws-cdk-lib/aws-lambda')
import apigateway = require('aws-cdk-lib/aws-apigateway')
import acm = require('aws-cdk-lib/aws-certificatemanager')
import { Duration } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'

import { ARCH, LOG_RETENTION, RUNTIME } from './constants'
import { FunctionUrl, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda'

export class AmmobinApiStack extends Construct {
  // shit we expose
  code: lambda.AssetCode
  lambda: lambda.Function
  lambdaFunctionUrl: FunctionUrl
  graphqlLambda: lambda.Function
  graphqlFunctionUrl: FunctionUrl
  constructor(
    scope: Construct,
    id: string,
    props: {
      name: string
      CODE_BASE: String
      // env to pass to lambda
      environment: any


    }
  ) {
    super(scope, id)

    const apiLambda = new lambda.Function(this, props.name + 'Lambda', {
      code: new lambda.AssetCode(props.CODE_BASE + 'api'),
      handler: 'api.handler',
      runtime: RUNTIME,
      architecture: ARCH,
      environment: props.environment,
      timeout: Duration.seconds(3),
      logRetention: LOG_RETENTION
    })

    this.lambdaFunctionUrl = apiLambda.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM })


    const graphqlLambda = new lambda.Function(this, 'graphql', {
      code: new lambda.AssetCode(props.CODE_BASE + 'graphql'),
      handler: 'graphql.handler',
      runtime: RUNTIME,
      architecture: ARCH,
      timeout: Duration.seconds(30),
      memorySize: 192,
      environment: props.environment,
      logRetention: LOG_RETENTION,
    })
    this.graphqlFunctionUrl = graphqlLambda.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM })
    this.graphqlLambda = graphqlLambda

    this.lambda = apiLambda
  }
}
