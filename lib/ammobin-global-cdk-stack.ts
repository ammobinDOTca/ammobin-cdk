import cdk = require('@aws-cdk/core')
import acm = require('@aws-cdk/aws-certificatemanager')
import { PUBLIC_URL } from './constants'

export class AmmobinGlobalCdkStack extends cdk.Stack {
  cert: acm.Certificate

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    this.cert = new acm.Certificate(this, 'RootGlobalCert', {
      domainName: PUBLIC_URL,
      validationMethod: acm.ValidationMethod.DNS,
    })
  }
}
