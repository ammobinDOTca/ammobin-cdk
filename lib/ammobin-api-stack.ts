import lambda = require('aws-cdk-lib/aws-lambda')
import apigateway = require('aws-cdk-lib/aws-apigateway')
import acm = require('aws-cdk-lib/aws-certificatemanager')
import { Duration } from 'aws-cdk-lib'
import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs';

import { ARCH, LOG_RETENTION, RUNTIME } from './constants'
import { FunctionUrl, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda'

export class AmmobinApiStack extends Construct {
  // shit we expose
  code: lambda.AssetCode
  lambda: lambda.Function
  api: apigateway.RestApi
  lambdaFunctionUrl: FunctionUrl
  graphqlLambda: lambda.Function
  graphqlFunctionUrl: FunctionUrl
  constructor(
    scope: Construct,
    id: string,
    props: {
      url: string
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

    const api = new apigateway.RestApi(this, props.name + 'AGW', {
      restApiName: props.name,
      description: `api for api lambda`,
      endpointTypes: [apigateway.EndpointType.EDGE],
      domainName: {
        // todo move this cert higher up + use wildcard
        certificate: new acm.Certificate(this, props.name + 'Cert', {
          domainName: props.url,
          validation: acm.CertificateValidation.fromDns()
        }),
        endpointType: apigateway.EndpointType.REGIONAL,
        domainName: props.url,
        securityPolicy: apigateway.SecurityPolicy.TLS_1_2
      },
      defaultCorsPreflightOptions: {
        maxAge: Duration.days(999),
        allowCredentials: false,
        allowOrigins: ['*']
      },
      deployOptions: { stageName: 'api' }, // to match with cloudfront path pattern ;)
    })
    api.addUsagePlan('throttle', {
      description: 'dont kill the aws bill',
      throttle: {
        burstLimit: 5,
        rateLimit: 1
      }
    })

    api.domainName
    api.root.addMethod('GET', new apigateway.LambdaIntegration(apiLambda))
    const clientResource = api.root.addResource('api')

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
    clientResource.addResource('graphql').addMethod('ANY', new apigateway.LambdaIntegration(graphqlLambda), {
      operationName: 'graphql',
      requestParameters: {
        'method.request.querystring.query': false, // NOTE: this has to be uri encoded
        'method.request.querystring.parameters': false
      }
    })
    clientResource.addResource('{proxy+}').addMethod('ANY', new apigateway.LambdaIntegration(apiLambda))

    this.lambda = apiLambda
    this.api = api
  }
}
