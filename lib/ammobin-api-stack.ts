import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import { Duration } from '@aws-cdk/core'
import { LOG_RETENTION } from './constants'

export class AmmobinApiStack extends cdk.Construct {
  // shit we expose
  code: lambda.AssetCode
  lambda: lambda.Function
  api: apigateway.RestApi
  graphqlLambda?: lambda.Function
  constructor(
    scope: cdk.Construct,
    id: string,
    props: {
      url: string
      handler: string
      name: string
      // env to pass to lambda
      environment: any
      code: lambda.AssetCode,
      timeout?: Duration
    }
  ) {
    super(scope, id)
    const { code } = props
    const apiLambda = new lambda.Function(this, props.name + 'Lambda', {
      code,
      handler: props.handler,
      runtime: lambda.Runtime.NODEJS_12_X,
      environment: props.environment,
      timeout: props.timeout || Duration.seconds(3),
      logRetention: LOG_RETENTION
    })

    const api = new apigateway.RestApi(this, props.name + 'AGW', {
      restApiName: props.name,
      description: `api for ${props.name} lambda`,
      endpointTypes: [apigateway.EndpointType.EDGE],
      domainName: {
        certificate: new acm.Certificate(this, props.name + 'Cert', {
          domainName: props.url,
          validationMethod: acm.ValidationMethod.DNS,
        }),
        endpointType: apigateway.EndpointType.REGIONAL,
        domainName: props.url,
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
        burstLimit: 250,
        rateLimit: 100
      }
    })

    api.domainName
    api.root.addMethod('GET', new apigateway.LambdaIntegration(apiLambda))
    const clientResource = api.root.addResource('api')

    if (props.name.startsWith('api')) {
      const graphqlLambda = new lambda.Function(this, 'graphql', {
        code,
        handler: 'src/api/graphql-lambda.handler',
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: Duration.seconds(30),
        memorySize: 192,
        environment: props.environment,
        logRetention: LOG_RETENTION
      })
      this.graphqlLambda = graphqlLambda
      clientResource.addResource('graphql').addMethod('ANY', new apigateway.LambdaIntegration(graphqlLambda), {
        operationName: 'graphql',
        requestParameters: {
          'method.request.querystring.query': false, // NOTE: this has to be uri encoded
          'method.request.querystring.parameters': false
        }
      })
    }
    clientResource.addResource('{proxy+}').addMethod('ANY', new apigateway.LambdaIntegration(apiLambda))

    this.lambda = apiLambda
    this.api = api
  }
}
