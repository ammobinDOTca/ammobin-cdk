import { LambdaDestination } from "@aws-cdk/aws-logs-destinations"
import { ILogGroup, LogGroup } from '@aws-cdk/aws-logs'
import cdk = require('@aws-cdk/core')
import Lambda = require('@aws-cdk/aws-lambda')
import * as iam from '@aws-cdk/aws-iam'
/**
 * generic export all json log messages to lambda (will forward to)
 * @param stack
 * @param lambda
 * @param kinesis
 */
export function exportLambdaLogsToLogger(stack: cdk.Stack, lambda: Lambda.Function, logLambda: Lambda.Function): ILogGroup {
  //recreate log group from assumption of auto created lambda log


  lambda.grantInvoke(new iam.ServicePrincipal(`logs.amazonaws.com`, { region: stack.region }))

  const logGroup = new LogGroup(stack, lambda.node.uniqueId + 'Logs', {
    logGroupName: '/aws/lambda/' + lambda.functionName
  })
  logGroup.addSubscriptionFilter('getAllJson' + lambda.node.uniqueId, {
    filterPattern: {
      logPatternString: '{$.level = "info"}' // all logs should be at this level (want all json logs, no need to export lambda cruff)
    },
    destination: new LambdaDestination(logLambda)
  })

  return logGroup
}
