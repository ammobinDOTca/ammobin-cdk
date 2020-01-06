#!/usr/bin/env node
import cdk = require('@aws-cdk/core')
import { AmmobinCdkStack } from '../lib/ammobin-cdk-stack'
import { AmmobinGlobalCdkStack } from '../lib/ammobin-global-cdk-stack'
import { AmmobinPipelineStack } from '../lib/ammobin-pipeline-stack'
import { GrafanaIamStack } from '../lib/grafana-iam-stack'
import { s3UploadStack } from '../lib/s3-upload-stack'
import { Stage } from '../lib/constants'

const app = new cdk.App()

// read in some props from environment vars
const {
  //siteBucket = 'ammobin-aws-site', // s3 bucket where static assets are uploaded to. this will need to be changed for each setup, bucket names are unique across AWS
  region = 'ca-central-1', // default to canada region
  publicUrl = 'aws.ammobin.ca', // current base domain of site
} = process.env

const stage = process.env['stage'] as Stage || 'prod'
const siteBucket = publicUrl.replace('.', '-')

new AmmobinGlobalCdkStack(app, 'AmmobinGlobalCdkStack', {
  env: {
    region: 'us-east-1', // cloudfront must use stuff here
  },
  publicUrl,
  siteBucket,
  stage
})

new AmmobinCdkStack(app, 'AmmobinCdkStack', {
  env: {
    region,
  },
  publicUrl,
  stage,
})

new GrafanaIamStack(app, 'GrafanaIamStack', {
  env: {
    region,
  },
})

new AmmobinPipelineStack(app, 'AmmobinPipelineStack', {
  env: {
    region
  }
})

new s3UploadStack(app, 's3UploadStack', {
  bucketArn: 'arn:aws:s3:::' + siteBucket, // this comes from output of AmmobinGlobalCdkStack
  env: {
    region,
  },
})
