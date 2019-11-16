import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
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
      src: string
      handler: string
      name: string
      // env to pass to lambda
      environment: any
      timeout?: Duration
    }
  ) {
    super(scope, id)
    const apiCode = new lambda.AssetCode(props.src)
    const apiLambda = new lambda.Function(this, props.name + 'Lambda', {
      code: apiCode,
      handler: props.handler,
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: props.environment,
      timeout: props.timeout || Duration.seconds(3),
      logRetention: LOG_RETENTION
    })

    const api = new apigateway.RestApi(this, props.name + 'AGW', {
      restApiName: props.name,
      description: `api for ${props.name} lambda`,
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      domainName: {
        certificate: new acm.Certificate(this, props.name + 'Cert', {
          domainName: props.url,
          validationMethod: acm.ValidationMethod.DNS,
        }),
        endpointType: apigateway.EndpointType.REGIONAL,
        domainName: props.url,
      },

      deployOptions: { stageName: 'api' }, // to match with cloudfront path pattern ;)
    })
    api.domainName
    api.root.addMethod('GET', new apigateway.LambdaIntegration(apiLambda))
    const clientResource = api.root.addResource('api')

    if (props.name.startsWith('api')) {
      const NODE_ENV = 'production'
      const DONT_LOG_CONSOLE = 'true'
      const PRIMARY_KEY = 'id'
      const TABLE_NAME = 'ammobinItems'
      const graphqlLambda = new lambda.Function(this, 'graphql', {
        code: new lambda.AssetCode('src/ammobin-api'),
        handler: 'dist/api/graphql-lambda.handler',
        runtime: lambda.Runtime.NODEJS_10_X,
        timeout: Duration.seconds(30),
        memorySize: 192,
        environment: {
          TABLE_NAME,
          PRIMARY_KEY,
          NODE_ENV,
          DONT_LOG_CONSOLE
        },
        logRetention: LOG_RETENTION
      })
      this.graphqlLambda = graphqlLambda
      clientResource.addResource('graphql').addMethod('ANY', new apigateway.LambdaIntegration(graphqlLambda))
    }
    clientResource.addResource('{proxy+}').addMethod('ANY', new apigateway.LambdaIntegration(apiLambda))

    this.code = apiCode
    this.lambda = apiLambda
    this.api = api
  }
}
