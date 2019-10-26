#!/usr/bin/env node
import cdk = require('@aws-cdk/core')
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack'
import { AmmobinGlobalCdkStack } from '../lib/ammobin-global-cdk-stack'

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
