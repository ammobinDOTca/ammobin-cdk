import { CodePipelineEvent } from 'aws-lambda'
import { Lambda, STS, CodePipeline } from 'aws-sdk'

const sts = new STS()
const codePipeline = new CodePipeline()

export interface PipelineInvokeUserParams {
  /**
   * role ARN to assume to be able to run targetFunctionArn
   */
  roleArn: string,
  /**
   * ARN of test lambda to invoke
   */
  targetFunctionArn: string,
  /**
   * base url of site to test
   * ie: https://ammobin.ca
   */
  base: string,
  /**
   * aws region of test lambda (ie: ca-central-1)
   */
  targetRegion: string
}


export async function handler(event: CodePipelineEvent) {
  console.log(event)
  const {
    roleArn,
    targetFunctionArn,
    base,
    targetRegion
  } = JSON.parse(event["CodePipeline.job"].data.actionConfiguration.configuration.UserParameters) as PipelineInvokeUserParams

  const t = await sts.assumeRole({
    RoleArn: roleArn,
    RoleSessionName: 'ass'
  }).promise()

  if (!t.Credentials) {
    throw 'sts did not give us creds for: ' + roleArn
  }

  const lambda = new Lambda({
    credentials: {
      accessKeyId: t.Credentials.AccessKeyId,
      secretAccessKey: t.Credentials.SecretAccessKey,
      sessionToken: t.Credentials.SessionToken
    },
    region: targetRegion
  })

  const f = await lambda.invoke({
    FunctionName: targetFunctionArn,
    Payload: JSON.stringify({ base })
  }).promise()

  console.log('f.LogResult', f.LogResult)

  if (f.FunctionError) {
    // lazy fail pipeline
    throw f.FunctionError
  } else {
    await codePipeline.putJobSuccessResult({
      jobId: event["CodePipeline.job"].id
    }).promise()
    return 'ok'
  }
};
