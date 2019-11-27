import cdk = require('@aws-cdk/core')
import iam = require('@aws-cdk/aws-iam')
interface Props extends cdk.StackProps {
  /**
   * ARN of bucket to grant putObject
   * if omitted, grant to all buckets
   */
  bucketArn?: string
}

/**
 * generate static assets on a schedule + upload to s3 site bucket
 */
export class s3UploadStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props: Props) {
    super(scope, id, props)

    // https://grafana.com/docs/features/datasources/cloudwatch/
    const grafanaIAMUser = new iam.User(this, 's3Upload', {})
    grafanaIAMUser.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:PutObject"
      ],
      resources: [props.bucketArn + '/*' || '*']
    }))

    // todo: use code build once azure wants money for pipelines?
  }
}
