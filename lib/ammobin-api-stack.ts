import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import s3 = require('@aws-cdk/aws-s3')
import cloudfront = require('@aws-cdk/aws-cloudfront')
import acm = require('@aws-cdk/aws-certificatemanager')

export class AmmobinApiStack extends cdk.Construct {
  // shit we expose
  code: lambda.AssetCode
  lambda: lambda.Function
  api: apigateway.RestApi

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
    }
  ) {
    super(scope, id)
    const apiCode = new lambda.AssetCode(props.src)
    const apiLambda = new lambda.Function(this, props.name + 'Lambda', {
      code: apiCode,
      handler: props.handler,
      runtime: lambda.Runtime.NODEJS_10_X,
      environment: props.environment,
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
    const clientResource = api.root.addResource('{proxy+}')
    clientResource.addMethod('GET', new apigateway.LambdaIntegration(apiLambda))
    this.code = apiCode
    this.lambda = apiLambda
    this.api = api
  }
}
