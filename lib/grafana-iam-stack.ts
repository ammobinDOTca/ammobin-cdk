import cdk = require('@aws-cdk/core')
import iam = require('@aws-cdk/aws-iam')

export class GrafanaIamStack extends cdk.Stack {

  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // https://grafana.com/docs/features/datasources/cloudwatch/
    const grafanaIAMUser = new iam.User(this, 'grafana', {})
    grafanaIAMUser.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "cloudwatch:DescribeAlarmsForMetric",
        "cloudwatch:ListMetrics",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:GetMetricData"
      ],
      resources: ['*']
    }))

    grafanaIAMUser.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ec2:DescribeTags",
        "ec2:DescribeInstances",
        "ec2:DescribeRegions"
      ],
      resources: ['*']
    }))

    grafanaIAMUser.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "tag:GetResources"
      ],
      resources: ['*']
    }))
  }
}
