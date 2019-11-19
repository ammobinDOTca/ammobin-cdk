import { LambdaDestination } from "@aws-cdk/aws-logs-destinations"
import * as CloudWatchLogs from '@aws-cdk/aws-logs'
import cdk = require('@aws-cdk/core')
import Lambda = require('@aws-cdk/aws-lambda')
import * as Kinesis from '@aws-cdk/aws-kinesis'
import { LogGroup } from "@aws-cdk/aws-logs"
import * as iam from '@aws-cdk/aws-iam'
/**
 * generic export all json log messages to lambda (will forward to)
 * @param stack
 * @param lambda
 * @param kinesis
 */
export function exportLambdaLogsToLogger(stack: cdk.Stack, lambda: Lambda.Function, logLambda: Lambda.Function): CloudWatchLogs.ILogGroup {
  //recreate log group from assumption of auto created lambda log

  const logGroup = CloudWatchLogs.LogGroup.fromLogGroupArn(stack, lambda.node.uniqueId + 'Logs', cdk.Arn.format({
    service: 'logs',
    resource: 'log-group',
    sep: ':',
    resourceName: '/aws/lambda/' + lambda.functionName
  }, stack))


  // const f = new iam.ServicePrincipal(`logs.${stack.region}.amazonaws.com`, { region: stack.region })
  const f = new iam.ServicePrincipal(`logs.amazonaws.com`, { region: stack.region })

  lambda.grantInvoke(f)
  logGroup.addSubscriptionFilter('getAllJson' + lambda.node.uniqueId, {
    filterPattern: {
      logPatternString: '{$.message = *}'
    },
    destination: new LambdaDestination(logLambda)
  })

  return logGroup
}
