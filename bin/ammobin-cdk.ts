#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
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

const getFunctionUrls = () => {
  if (stage == 'beta') {
    if (site_region === 'CA') {
      return {
        imageFunctionUrl: 'jyfuzpgkgjnyfa7xhf3murrlb40gwdzl.lambda-url.ca-central-1.on.aws',
        //apiFunctionUrl: "ic7mlrwjxiautlmp7bzds4t3cu0rdtwf.lambda-url.ca-central-1.on.aws",
        graphqlFunctionUrl: '42ervs3vmods7p26trlm5luaiy0rgruh.lambda-url.ca-central-1.on.aws',
      }
    } else if (site_region == 'US') {
      return {
        imageFunctionUrl: 'oxznamwj2any7tlldl2yrirhbe0hvefr.lambda-url.us-west-2.on.aws',
        //apiFunctionUrl: "igv6jn3u2fp6vl2yrgoqek5gne0gedto.lambda-url.us-west-2.on.aws",
        graphqlFunctionUrl: 'l3n355nzw7i2ufgm76kntuecxi0jeipx.lambda-url.us-west-2.on.aws',
      }
    }
  } else if (stage == "prod") {
    if (site_region === 'CA') {
      return {
        imageFunctionUrl: 'xsirnqhsbkrxk73yknlc6nbeqe0yvlvj.lambda-url.ca-central-1.on.aws',
        //apiFunctionUrl: "6oqoa3ajhjvogn5ivpjaqsup7q0lwosy.lambda-url.ca-central-1.on.aws",
        graphqlFunctionUrl: 'pekphf6zumclwhxyjfk52udm7i0stsjy.lambda-url.ca-central-1.on.aws',
      }
    } else if (site_region == 'US') {
      return {
        imageFunctionUrl: '7dvkbg6jazyi5o55prgcmcz6va0tapak.lambda-url.us-west-2.on.aws',
       // apiFunctionUrl: "dd2ljdjyjjhz5a5meml3hlax3i0fjcqk.lambda-url.us-west-2.on.aws",
       graphqlFunctionUrl: 'gyj3dkfohpknq567iebv7gjnuq0oosff.lambda-url.us-west-2.on.aws',
      }
    }
  }

  throw new Error(`unsupport region ${site_region} stage ${stage}`)
}

// deployed by pipeline, do not manually deploy
new AmmobinGlobalCdkStack(app, 'AmmobinGlobalCdkStack', {
  env: {
    region: 'us-east-1', // cloudfront must use stuff here
  },
  region: site_region,
  publicUrl,
  siteBucket,
  stage,
  email,
  ...getFunctionUrls()
})

// deployed by pipeline, do not manually deploy
new AmmobinCdkStack(app, 'AmmobinCdkStack', {
  env: {
    region,
  },
  publicUrl,
  stage,
  apiCode,
  email,
  region: site_region
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
