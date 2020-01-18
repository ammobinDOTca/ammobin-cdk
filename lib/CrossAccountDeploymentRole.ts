import { Construct } from '@aws-cdk/core';
import { PolicyStatement, Role, AccountPrincipal, Policy, Effect } from '@aws-cdk/aws-iam'
import { Region, Stage } from './constants';

export interface CrossAccountDeploymentRoleProps {
  /**
   * region to deploy to
   * ie: CA, US, FR
   */
  targetRegionName: Region
  serviceName: string;
  /** account ID where CodePipeline/CodeBuild is hosted */
  deployingAccountId: string;
  /** stage for which this role is being created
   * ie beta, prod
   */
  targetStageName: Stage;
  /** Permissions that deployer needs to assume to deploy stack */
  deployPermissions: PolicyStatement[];
}

/**
 * Creates an IAM role to allow for cross-account deployment of a service's resources.
 */
export class CrossAccountDeploymentRole extends Construct {
  public static getRoleNameForService(serviceName: string, stage: Stage, region: Region): string {
    return `${serviceName}-${stage}-${region}-deployer-role`;
  }

  public static getRoleArnForService(serviceName: string, stage: Stage, region: Region, accountId: string): string {
    return `arn:aws:iam::${accountId}:role/${CrossAccountDeploymentRole.getRoleNameForService(serviceName, stage, region)}`;
  }

  readonly deployerRole: Role;
  readonly deployerPolicy: Policy;
  readonly roleName: string;

  public constructor(parent: Construct, id: string, props: CrossAccountDeploymentRoleProps) {
    super(parent, id);
    this.roleName = CrossAccountDeploymentRole.getRoleNameForService(props.serviceName, props.targetStageName, props.targetRegionName);
    // Cross-account assume role
    // https://awslabs.github.io/aws-cdk/refs/_aws-cdk_aws-iam.html#configuring-an-externalid
    this.deployerRole = new Role(this, 'deployerRole', {
      roleName: this.roleName,
      assumedBy: new AccountPrincipal(props.deployingAccountId),
    });

    // todo: restrict this better.....
    const passrole = new PolicyStatement({
      actions: [
        'iam:PassRole',
      ],
      effect: Effect.ALLOW,
      resources: ['*']
    })

    this.deployerPolicy = new Policy(this, 'deployerPolicy', {
      policyName: `${this.roleName}-policy`,
      statements: [passrole, ...props.deployPermissions],
    });
    this.deployerPolicy.attachToRole(this.deployerRole);
  }
}
