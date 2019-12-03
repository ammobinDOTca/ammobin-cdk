import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import { Duration } from '@aws-cdk/core'
import { LOG_RETENTION } from './constants'

export class AmmobinImagesStack extends cdk.Construct {


  constructor(
    scope: cdk.Construct,
    id: string,
    props: {
      url: string
    }
  ) {
    super(scope, id)
    const code = new lambda.AssetCode('./dist/image-proxy')
    const name = 'imagesProxy'
    const apiLambda = new lambda.Function(this, name + 'Lambda', {
      code,
      handler: 'main.handler',
      runtime: lambda.Runtime.NODEJS_12_X,
      environment: {
        production: 'true',
        'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
      },
      timeout: Duration.seconds(30),
      logRetention: LOG_RETENTION,
      layers: [
        // https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:145266761615:applications~image-magick-lambda-layer
        lambda.LayerVersion.fromLayerVersionArn(this, 'lazyARN', 'arn:aws:lambda:ca-central-1:911856505652:layer:image-magick:1')]
    })

    const api = new apigateway.RestApi(this, name + 'AGW', {
      restApiName: name,
      description: `api for ${name} lambda`,
      endpointTypes: [apigateway.EndpointType.EDGE],
      domainName: {
        certificate: new acm.Certificate(this, name + 'Cert', {
          domainName: props.url,
          validationMethod: acm.ValidationMethod.DNS,
        }),
        endpointType: apigateway.EndpointType.REGIONAL,
        domainName: props.url,
      },
      binaryMediaTypes: ['*/*'], // lazy
      deployOptions: { stageName: 'images' }, // to match with cloudfront path pattern ;)
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
    api.root.addResource('{proxy+}').addMethod('GET', new apigateway.LambdaIntegration(apiLambda))

  }
}
