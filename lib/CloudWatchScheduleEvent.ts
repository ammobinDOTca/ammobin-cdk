import lambda = require('@aws-cdk/aws-lambda')
import events = require('@aws-cdk/aws-events')

/**
 * creates cloudwatch cron event mapping for invoking a lambda
 * nov 2019: waiting for CDK to support this themselves
 */
export class CloudwatchScheduleEvent implements lambda.IEventSource {
  constructor(readonly rule: events.Rule) {
  }

  public bind(target: lambda.IFunction) {
    this.rule.addTarget({
      bind: ((): events.RuleTargetConfig => {
        return {
          id: '', // let cdk auto gen this for us
          arn: target.functionArn
        }
      })
    })
  }
}
