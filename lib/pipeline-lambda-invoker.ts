import { Construct, Duration, } from "@aws-cdk/core";
import { Function, Runtime, Code } from '@aws-cdk/aws-lambda'
import { PolicyStatement, Role, AccountPrincipal, Policy, Effect, ManagedPolicy, ServicePrincipal } from '@aws-cdk/aws-iam'
import { Region, Stage, TEST_LAMBDA_NAME, LOG_RETENTION } from './constants'
/**
 * pipeline wont (as of jan 2020) invoke cross region or account lambdas....
 * .. https://duckduckgo.com/?q=fine+i%27ll+do+it+myself+thanos&t=canonical&atb=v121-1&iax=images&ia=images
 */

interface props {
  /**
   * lambda role to use to invoke the target remote lambda
   */
  role: Role,
  /**
   * target cross account where lambda exists
   */
  targetAccount: String

  /**
   * url domain to test
   */
  base: string
}

export class PipelineLambdaInvoker extends Construct {
  function: Function
  constructor(scope: Construct, id: string, props: props) {
    super(scope, id);

    // NOTE: this assumes ca-central-1

    const lambdaAssumeRole = new Role(this, 'lambdaAssumRole', {
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    })
    lambdaAssumeRole.addToPolicy(new PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [
        props.role.roleArn,
      ]
    }))

    this.function = new Function(scope, 'pipeline' + props.targetAccount + 'TestInvoker', {
      role: lambdaAssumeRole,
      runtime: Runtime.NODEJS_12_X,
      timeout: Duration.minutes(5),
      logRetention: LOG_RETENTION,
      handler: 'index.handler',
      code: Code.fromInline(`

      const {Lambda, STS} = require('aws-sdk')
      const sts = new STS()

      exports.handler = async (event) => {
        console.log(event)
        const t = await sts.assumeRole({
            RoleArn:'${props.role.roleArn}',
            RoleSessionName:'ass'
        }).promise()

        const lambda = new Lambda({
            credentials: {
                accessKeyId: t.Credentials.AccessKeyId,
                secretAccessKey: t.Credentials.SecretAccessKey,
                sessionToken: t.Credentials.SessionToken
            }
        })
        const f = await lambda.invoke({
            FunctionName:'arn:aws:lambda:ca-central-1:${props.targetAccount}:function:${TEST_LAMBDA_NAME}',
            Payload:JSON.stringify({base:'${props.base}'})
        }).promise()
        console.log(f.LogResult)
        if(f.FunctionError){
          throw f.FunctionError
        } else {
          return f.Payload
        }
      };
      `)
    })
  }
}
