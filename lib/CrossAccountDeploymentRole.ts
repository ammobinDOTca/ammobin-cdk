import { Construct, Arn } from '@aws-cdk/core';
import { PolicyStatement, Role, AccountPrincipal, Policy, Effect, ManagedPolicy } from '@aws-cdk/aws-iam'
import { Region, Stage, TEST_LAMBDA_NAME } from './constants';

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
export class CrossAccountDeploymentRoles extends Construct {
  public static getDeployRoleNameForService(serviceName: string, stage: Stage, region: Region): string {
    return `${serviceName}-${stage}-${region}-deployer-role`;
  }

  public static getDeployRoleArnForService(serviceName: string, stage: Stage, region: Region, accountId: string): string {
    return `arn:aws:iam::${accountId}:role/${CrossAccountDeploymentRoles.getDeployRoleNameForService(serviceName, stage, region)}`;
  }

  public static getTestRoleNameForService(serviceName: string, stage: Stage, region: Region): string {
    return `${serviceName}-${stage}-${region}-test-invoke-role`;
  }

  public static getTestRoleArnForService(serviceName: string, stage: Stage, region: Region, accountId: string): string {
    return `arn:aws:iam::${accountId}:role/${CrossAccountDeploymentRoles.getTestRoleNameForService(serviceName, stage, region)}`;
  }

  readonly deployerRole: Role;
  readonly deployerPolicy: Policy;
  readonly roleName: string;

  readonly testInvokeRole: Role;
  readonly testInvokePolicy: Policy;
  readonly testInvokeRoleName: string;

  public constructor(parent: Construct, id: string, props: CrossAccountDeploymentRoleProps) {
    super(parent, id);
    /**
     *
     * pipeline deploy role
     *
     */
    this.roleName = CrossAccountDeploymentRoles.getDeployRoleNameForService(props.serviceName, props.targetStageName, props.targetRegionName);
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

    /**
     *
     * pipeline test lambda invoke
     *
     */

    this.testInvokeRoleName = CrossAccountDeploymentRoles.getTestRoleNameForService(props.serviceName, props.targetStageName, props.targetRegionName);
    this.testInvokeRole = new Role(this, 'testInvokeRole', {
      roleName: this.testInvokeRoleName,
      assumedBy: new AccountPrincipal(props.deployingAccountId),
    });
    this.testInvokeRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'))

    this.testInvokePolicy = new Policy(this, 'testInvokePolicy', {
      policyName: `${this.testInvokeRoleName}-policy`,
      statements: [
        new PolicyStatement({
          actions: ['lambda:InvokeFunction'],
          resources: [
            // `arn:aws:lambda:ca-central-1:*:function:${TEST_LAMBDA_NAME}`
            '*'
          ]
        })
      ],

    });

    this.testInvokePolicy.attachToRole(this.testInvokeRole)
  }
}
