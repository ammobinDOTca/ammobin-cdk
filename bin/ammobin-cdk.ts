#!/usr/bin/env node
import cdk = require('@aws-cdk/core')
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack'
import { AmmobinGlobalCdkStack } from '../lib/ammobin-global-cdk-stack'
import { AmmobinPipelineStack } from '../lib/ammobin-pipeline-stack'
import { IamStack } from '../lib/grafana-iam-stack'
import { s3UploadStack } from '../lib/s3-upload-stack'
import { Region, Stage } from '../lib/constants'

const app = new cdk.App()

// read in some props from environment vars
const {
  //siteBucket = 'ammobin-aws-site', // s3 bucket where static assets are uploaded to. this will need to be changed for each setup, bucket names are unique across AWS
  region = 'ca-central-1', // default to canada region
  apiCode = '../ammobin-api',
  email = 'contact' + '@ammobin.ca', // email to send alarms to
} = process.env

const stage = process.env['stage'] as Stage || 'prod'
const site_region = process.env['site_region'] as Region || 'CA'
const baseDomain = `ammobin.${site_region.toLowerCase()}`

let publicUrl = baseDomain
if (stage === 'beta') {
  publicUrl = 'beta.' + baseDomain
}
const siteBucket = publicUrl.replace(/\./gi, '-')

// deployed by pipeline, do not manually deploy
new AmmobinGlobalCdkStack(app, 'AmmobinGlobalCdkStack', {
  env: {
    region: 'us-east-1', // cloudfront must use stuff here
  },
  region: site_region,
  publicUrl,
  siteBucket,
  stage,
  email
})

// deployed by pipeline, do not manually deploy
new AmmobinCdkStack(app, 'AmmobinCdkStack', {
  env: {
    region,
  },
  publicUrl,
  stage,
  apiCode,
  email
})

/**
 * todo all these need to be params....
 */
const rootAccount = '911856505652' // where route53 + pipeline exist


new IamStack(app, 'IamStack', {
  env: {
    region,
  },
  stage,
  deployingAccount: rootAccount,
  region: site_region
})

new AmmobinPipelineStack(app, 'AmmobinPipelineStack', {
  env: {
    region,
    account: rootAccount // only deploy to root account
  },
  regions: ['CA', 'US'],
  stages: ['beta', 'prod']
})

new s3UploadStack(app, 's3UploadStack', {
  bucketArn: 'arn:aws:s3:::' + siteBucket, // this comes from output of AmmobinGlobalCdkStack
  env: {
    region,
  },
})
