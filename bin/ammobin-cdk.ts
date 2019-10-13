#!/usr/bin/env node
import cdk = require('@aws-cdk/core')
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack'
import { AmmobinGlobalCdkStack } from '../lib/ammobin-global-cdk-stack'

const app = new cdk.App()

new AmmobinCdkStack(app, 'AmmobinCdkStack', {
  env: {
    region: 'ca-central-1',
  },
})

new AmmobinGlobalCdkStack(app, 'AmmobinGlobalCdkStack', {
  env: {
    region: 'us-east-1',
  },
})
