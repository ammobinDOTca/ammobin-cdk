import { CodePipelineEvent } from 'aws-lambda'
import {Lambda, InvokeCommand} from '@aws-sdk/client-lambda'
import {CodePipeline} from '@aws-sdk/client-codepipeline'
import {fromTemporaryCredentials} from '@aws-sdk/credential-providers'
const codePipeline = new CodePipeline({})

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

  const lambda = new Lambda({
    credentials: fromTemporaryCredentials({
      params:{
        RoleArn:roleArn,
      }
    }),
    region: targetRegion
  })

  try {
    const f = await lambda.send(new InvokeCommand({
      FunctionName: targetFunctionArn,
      Payload: Buffer.from(JSON.stringify({ base }))
    }))

    console.log('f', JSON.stringify(f,null,' '))

    if (f.FunctionError) {
      // lazy fail pipeline
      await codePipeline.putJobFailureResult({
        jobId: event["CodePipeline.job"].id, failureDetails: {
          message: f.FunctionError?.toString(), type: 'JobFailed'
        }
      })
      return 'not ok'
    } else {
      await codePipeline.putJobSuccessResult({
        jobId: event["CodePipeline.job"].id
      })
      return 'ok'
    }
  } catch (e: any) {
    await codePipeline.putJobFailureResult({
      jobId: event["CodePipeline.job"].id, failureDetails: {
        message: e.toString(),
         type: 'JobFailed'
      }
    })
    return 'not ok'
  }
};
