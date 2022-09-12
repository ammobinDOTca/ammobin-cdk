import cdk = require('aws-cdk-lib')
import iam = require('aws-cdk-lib/aws-iam')
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam'

import { serviceName, Stage, Region } from './constants'
import { CrossAccountDeploymentRoles } from './CrossAccountDeploymentRole'

interface props extends cdk.StackProps {
  /**
   * stage
   */
  stage: Stage
  /**
   * aws account id that the root pipeline is hosted in
   * (ie: the account that will need to assume the deploy stack role in this account)
   */
  deployingAccount: string

  /**
   * region that this stack will represent
   */
  region: Region
}

/**
 * collection
 */
export class IamStack extends cdk.Stack {

  constructor(scope: cdk.App, id: string, props: props) {
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

    new CrossAccountDeploymentRoles(this, 'deployRole', {
      targetStageName: props.stage,
      targetRegionName: props.region,
      serviceName,
      deployingAccountId: props.deployingAccount,
      deployPermissions: [
        new PolicyStatement({
          actions: [
            '*', // todo: restrict this to only what is needed for deploying the stacks....
          ],
          effect: Effect.ALLOW,
          resources: ['*']
        })
      ]
    })
  }
}
