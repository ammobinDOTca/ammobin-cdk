import lambda = require('@aws-cdk/aws-lambda')
import apigateway = require('@aws-cdk/aws-apigateway')
import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import { Duration } from '@aws-cdk/core'
import { LOG_RETENTION, Region, RUNTIME, Stage } from './constants'
import { CfnApplication } from '@aws-cdk/aws-sam'
import { SecurityPolicy } from '@aws-cdk/aws-apigateway'
export class AmmobinImagesStack extends cdk.Construct {


  constructor(
    scope: cdk.Construct,
    id: string,
    props: {
      url: string,
      stage: Stage,
      region: Region
    }
  ) {
    super(scope, id)

    const imageMagic = new CfnApplication(scope as any, 'imageMagic', {
      location: {
        applicationId: 'arn:aws:serverlessrepo:us-east-1:145266761615:applications/image-magick-lambda-layer',
        semanticVersion: '1.0.0'
      }
    })

    const code = new lambda.AssetCode('./dist/lambdas/image-proxy')
    const name = 'imagesProxy'
    const apiLambda = new lambda.Function(this, name + 'Lambda', {
      code,
      handler: 'main.handler',
      runtime: RUNTIME,
      environment: {
        production: 'true',
        region: props.region,
        stage: props.stage,
        'NODE_OPTIONS': '--tls-min-v1.1' // allow more certs to connect (as of nov 2019)
      },
      timeout: Duration.seconds(30),
      logRetention: LOG_RETENTION,
      layers: [
        lambda.LayerVersion.fromLayerVersionArn(this, 'imageLayer', imageMagic.getAtt('Outputs.LayerVersion').toString())
      ]
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
        securityPolicy: SecurityPolicy.TLS_1_2
      },
      binaryMediaTypes: ['*/*'], // lazy
      deployOptions: { stageName: 'images' }, // to match with cloudfront path pattern ;)
    })
    api.addUsagePlan('throttle', {
      description: 'dont kill the aws bill',
      throttle: {
        burstLimit: 10,
        rateLimit: 2
      }
    })
    api.domainName
    api.root.addMethod('GET', new apigateway.LambdaIntegration(apiLambda))
    api.root.addResource('{proxy+}').addMethod('GET', new apigateway.LambdaIntegration(apiLambda))

  }
}
