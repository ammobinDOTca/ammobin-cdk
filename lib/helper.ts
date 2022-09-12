import { LambdaDestination } from "aws-cdk-lib/aws-logs-destinations"
import { ILogGroup, LogGroup } from 'aws-cdk-lib/aws-logs'
import cdk = require('aws-cdk-lib')
import Lambda = require('aws-cdk-lib/aws-lambda')
import * as iam from 'aws-cdk-lib/aws-iam'
import { Region, Stage } from './constants'
/**
 *
 * @param stack
 * @param lambda lambda's logs to export
 * @param logLambda lambda to subscribe to log group and forward logs to elastic search
 */
export function exportLambdaLogsToLogger(stack: cdk.Stack, lambda: Lambda.Function, logLambda: Lambda.Function): ILogGroup {
  //recreate log group from assumption of auto created lambda log


  lambda.grantInvoke(new iam.ServicePrincipal(`logs.amazonaws.com`, {}))

  const logGroup = LogGroup.fromLogGroupArn(stack, lambda.node.id + 'Logs', cdk.Arn.format({
    service: 'logs',
    resource: 'log-group',
    resourceName: '/aws/lambda/' + lambda.functionName
  }, stack))
  logGroup.node.addDependency(lambda) // need to wait for lambda to exist first
  logGroup.node.addDependency(logLambda)
  logGroup.addSubscriptionFilter('getAllJson' + lambda.node.id, {
    filterPattern: {
      logPatternString: '{$.level = "info"}' // all logs should be at this level (want all json logs, no need to export lambda cruff)
    },
    destination: new LambdaDestination(logLambda)
  })

  return logGroup
}


export function regionToAWSRegion(region: Region): string {
  switch (region) {
    case 'CA':
      return 'ca-central-1'
    case 'US':
      return 'us-west-2'
    default:
      throw 'unknown region: ' + region
  }
}


export function getAccountForRegionAndStage(region: Region, stage: Stage): string {
  switch (region) {
    case 'CA':
      switch (stage) {
        case 'beta':
          return '652374912961'
        case 'prod':
          return '968559063536'
      }
    case 'US':
      switch (stage) {
        case 'beta':
          return '734748381677'
        case 'prod':
          return '350712191526'
      }
  }
  throw 'unknown region+stage: ' + region + ' ' + stage
}
