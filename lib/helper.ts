import { KinesisDestination } from "@aws-cdk/aws-logs-destinations"
import * as CloudWatchLogs from '@aws-cdk/aws-logs'
import cdk = require('@aws-cdk/core')
import Lambda = require('@aws-cdk/aws-lambda')
import * as Kinesis from '@aws-cdk/aws-kinesis'
import { LogGroup } from "@aws-cdk/aws-logs"

/**
 * generic export all json log messages to kinesis (will forward to)
 * @param stack
 * @param lambda
 * @param kinesis
 */
export function exportLambdaLogsToKinesis(stack: cdk.Stack, lambda: Lambda.Function, kinesis: Kinesis.Stream): CloudWatchLogs.ILogGroup {
  //recreate log group from assumption of auto created lambda log

  const logGroup = CloudWatchLogs.LogGroup.fromLogGroupArn(stack, lambda.node.uniqueId + 'Logs', cdk.Arn.format({
    service: 'logs',
    resource: 'log-group',
    sep: ':',
    resourceName: '/aws/lambda/' + lambda.functionName
  }, stack))

  logGroup.addSubscriptionFilter('getAllJson', {
    filterPattern: {
      logPatternString: ''
    },
    destination: new KinesisDestination(kinesis)
  })

  return logGroup
}
