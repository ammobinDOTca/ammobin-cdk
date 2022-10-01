import lambda = require('aws-cdk-lib/aws-lambda')
import apigateway = require('aws-cdk-lib/aws-apigateway')
import cdk = require('aws-cdk-lib')
import acm = require('aws-cdk-lib/aws-certificatemanager')
import { Duration } from 'aws-cdk-lib'
import { LOG_RETENTION, Region, RUNTIME, Stage } from './constants'
import { CfnApplication } from 'aws-cdk-lib/aws-sam'
import { SecurityPolicy } from 'aws-cdk-lib/aws-apigateway'
import { Construct } from 'constructs'
import { CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager'
import { Architecture, FunctionUrl, FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda'

export class AmmobinImagesStack extends Construct {

  functionUrl: FunctionUrl

  constructor(
    scope: Construct,
    id: string,
    props: {
      url: string,
      stage: Stage,
      region: Region
    }
  ) {
    super(scope, id)

    // todo: ARM image.....
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
      //architecture:Architecture.ARM_64,
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

    this.functionUrl = apiLambda.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM })

    const api = new apigateway.RestApi(this, name + 'AGW', {
      restApiName: name,
      description: `api for ${name} lambda`,
      endpointTypes: [apigateway.EndpointType.EDGE],
      domainName: {
        certificate: new acm.Certificate(this, name + 'Cert', {
          domainName: props.url,
          validation: CertificateValidation.fromDns()
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
