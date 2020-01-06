import { LambdaDestination } from "@aws-cdk/aws-logs-destinations"
import { ILogGroup, LogGroup } from '@aws-cdk/aws-logs'
import cdk = require('@aws-cdk/core')
import Lambda = require('@aws-cdk/aws-lambda')
import * as iam from '@aws-cdk/aws-iam'
/**
 *
 * @param stack
 * @param lambda lambda's logs to export
 * @param logLambda lambda to subscribe to log group and forward logs to elastic search
 */
export function exportLambdaLogsToLogger(stack: cdk.Stack, lambda: Lambda.Function, logLambda: Lambda.Function): ILogGroup {
  //recreate log group from assumption of auto created lambda log


  lambda.grantInvoke(new iam.ServicePrincipal(`logs.amazonaws.com`, { region: stack.region }))

  const logGroup = LogGroup.fromLogGroupArn(stack, lambda.node.uniqueId + 'Logs', cdk.Arn.format({
    service: 'logs',
    resource: 'log-group',
    sep: ':',
    resourceName: '/aws/lambda/' + lambda.functionName
  }, stack))
  logGroup.node.addDependency(lambda) // need to wait for lambda to exist first
  logGroup.node.addDependency(logLambda)
  logGroup.addSubscriptionFilter('getAllJson' + lambda.node.uniqueId, {
    filterPattern: {
      logPatternString: '{$.level = "info"}' // all logs should be at this level (want all json logs, no need to export lambda cruff)
    },
    destination: new LambdaDestination(logLambda)
  })

  return logGroup
}
