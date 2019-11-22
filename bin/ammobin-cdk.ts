#!/usr/bin/env node
import cdk = require('@aws-cdk/core')
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack'
import { AmmobinGlobalCdkStack } from '../lib/ammobin-global-cdk-stack'
import { GrafanaIamStack } from '../lib/grafana-iam-stack'
import { s3UploadStack } from '../lib/s3-upload-stack'

const app = new cdk.App()

const globalAmmo = new AmmobinGlobalCdkStack(app, 'AmmobinGlobalCdkStack', {
  env: {
    region: 'us-east-1',
  },
})

new AmmobinCdkStack(app, 'AmmobinCdkStack', {
  // edgeLamdaVersion: globalAmmo.nuxtRerouterVersion.version,
  // edgeLamdaArn: globalAmmo.nuxtRerouterVersion.functionArn,
  env: {
    region: 'ca-central-1',
  },
}) //.addDependency(globalAmmo)

new GrafanaIamStack(app, 'GrafanaIamStack', {
  env: {
    region: 'ca-central-1',
  },
})

new s3UploadStack(app, 's3UploadStack', {
  bucketArn: 'arn:aws:s3:::ammobin-aws-site',
  env: {
    region: 'ca-central-1',
  },
})
