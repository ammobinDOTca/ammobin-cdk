import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import { App, Stack, StackProps, SecretValue, Arn } from '@aws-cdk/core';
import iam = require('@aws-cdk/aws-iam')
import { Bucket } from '@aws-cdk/aws-s3'
import { Function } from '@aws-cdk/aws-lambda'

import { CrossAccountDeploymentRoles } from './CrossAccountDeploymentRole';
import { serviceName, Stage, Region, TEST_LAMBDA_NAME } from './constants';
import { PipelineLambdaInvoker } from './pipeline-lambda-invoker';

export interface PipelineStackProps extends StackProps {
  /**
   * aws account id used for beta CA
   */
  caBetaAWSAccountId: string
  /**
    * aws account id used for prod CA
    */
  caProdAWSAccountId: string
}

export class AmmobinPipelineStack extends Stack {
  //https://winterwindsoftware.com/serverless-cicd-pipelines-with-aws-cdk/

  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const API_SOURCE = 'ammobinApi'
    const nodejs = 12
    const buildImage = codebuild.LinuxBuildImage.STANDARD_3_0
    const CDK_BUILD_OUT = 'CdkBuildOutput';
    const API_BUILD_OUT = 'ApiBuildOutput'

    // role used in beta account to deploy stack there
    const betaDeployRole = iam.Role.fromRoleArn(this, 'deployBetaRole', CrossAccountDeploymentRoles.getDeployRoleArnForService(serviceName, 'beta', 'CA', props.caBetaAWSAccountId))

    const betaTestInvokeRole = iam.Role.fromRoleArn(this, 'testInvokeBetaRole', CrossAccountDeploymentRoles.getTestRoleArnForService(serviceName, 'beta', 'CA', props.caBetaAWSAccountId))


    const prodDeployRole = iam.Role.fromRoleArn(this, 'prodDeployRole', CrossAccountDeploymentRoles.getDeployRoleArnForService(serviceName, 'prod', 'CA', props.caProdAWSAccountId))

    // role used by the pipeline itself
    const pipelineRole = new iam.Role(this, 'pipelineRole', {
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
    })

    // role used by codebuild to assume into beta account deployment role
    const pipelineDeployToBetaAccountRole = new iam.Role(this, 'pipelineDeployToBetaAccount', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com')
    })
    // allow the codeBuild that is assuming the deploy role to run cdk deploy in the external account
    pipelineDeployToBetaAccountRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [
        betaDeployRole.roleArn,
        prodDeployRole.roleArn,
      ]
    }))

    const s3BuildCache = new Bucket(this, 's3BuildCache', {
      // todo: expire build cache?
    })

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs },
            commands: [
              'npm install',
              'npm run postinstall',
              `cd $CODEBUILD_SRC_DIR_${API_SOURCE}`,
              'npm install',
              'cd $CODEBUILD_SRC_DIR',
            ]
          },
          build: {
            commands: [
              `cd $CODEBUILD_SRC_DIR_${API_SOURCE}`,
              'npm run build-lambda',
              'cd $CODEBUILD_SRC_DIR',
              'npm run build',
            ],
          },
        },
        // todo: fix this
        cache: {
          paths: [
            '$CODEBUILD_SRC_DIR/node_modules/**/*',
            `$CODEBUILD_SRC_DIR_${API_SOURCE}/node_modules/**/*`
          ]
        },
        artifacts: {
          'secondary-artifacts': {
            [CDK_BUILD_OUT]: {
              'base-directory': '$CODEBUILD_SRC_DIR',
              files: [
                '**/*'
              ],
            },
            [API_BUILD_OUT]: {
              'base-directory': `$CODEBUILD_SRC_DIR_${API_SOURCE}`,
              files: [
                'lambda/**/*'
              ]
            }
          }
        }
      }),
      environment: {
        buildImage
      },
      cache: codebuild.Cache.bucket(s3BuildCache, { prefix: 'CdkBuild' })
    });

    const generateDeployToAccountBuild = (name: string, role: string, stage: Stage, region: Region, stack: string) => {
      return new codebuild.PipelineProject(this, name + stage + region, {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': { nodejs },
              commands: [
                'pwd',
              ]
            },
            build: {
              commands: [
                // note: environment vars dont copy btw commands....
                `set -e
              CREDS=$(aws sts assume-role --role-arn ${role} --out json --role-session-name codebuild-sess )
              echo $CREDS > temp_creds.json
              export AWS_ACCESS_KEY_ID=$(node -p "require('./temp_creds.json').Credentials.AccessKeyId")
              export AWS_SECRET_ACCESS_KEY=$(node -p "require('./temp_creds.json').Credentials.SecretAccessKey")
              export AWS_SESSION_TOKEN=$(node -p "require('./temp_creds.json').Credentials.SessionToken")
              echo AWS_ACCESS_KEY_ID $AWS_ACCESS_KEY_ID
              stage=${stage} apiCode=$CODEBUILD_SRC_DIR_${API_BUILD_OUT} node node_modules/aws-cdk/bin/cdk.js deploy ${stack}`,
              ],
            },
          },
        }),
        environment: {
          buildImage
        },
        role: pipelineDeployToBetaAccountRole, // important.....(need custom role to allow us to manually assume role in beta account)
      });
    }

    const cdkDeployCloudFront = generateDeployToAccountBuild('deployCloudFront', betaDeployRole.roleArn, 'beta', 'CA', 'AmmobinGlobalCdkStack')
    const cdkDeployApi = generateDeployToAccountBuild('deployApi', betaDeployRole.roleArn, 'beta', 'CA', 'AmmobinCdkStack')

    const cdkDeployProdCloudFront = generateDeployToAccountBuild('deployCloudFront', prodDeployRole.roleArn, 'prod', 'CA', 'AmmobinGlobalCdkStack')
    const cdkDeployProdApi = generateDeployToAccountBuild('deployApi', prodDeployRole.roleArn, 'prod', 'CA', 'AmmobinCdkStack')


    const sourceOutput = new codepipeline.Artifact('ammobinCdk');
    const apiSourceOutput = new codepipeline.Artifact(API_SOURCE);

    const cdkBuildOutput = new codepipeline.Artifact(CDK_BUILD_OUT);
    const apiBuildOutput = new codepipeline.Artifact(API_BUILD_OUT);

    const artifactBucket = Bucket.fromBucketName(this, 'artifactBucket', cdkBuildOutput.bucketName)
    // todo: expire artifacts + reduce storage class...

    // todo: confirm if this is needed
    artifactBucket.grantRead(betaDeployRole) // let beta account read the build artifacts so it can actually deploy them
    artifactBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:readBucket'],
      principals: [betaDeployRole],
    }))


    const oauthToken = SecretValue.secretsManager('github-auth-token'); // should manually create beforehand. pipeline wants to make api calls with this token before one has a chance to populate it

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      role: pipelineRole,
      restartExecutionOnUpdate: true,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.GitHubSourceAction({
              actionName: 'github_source',
              owner: 'ammobinDOTca',
              repo: 'ammobin-cdk',
              oauthToken,
              output: sourceOutput
            }),
            new codepipeline_actions.GitHubSourceAction({
              actionName: 'github_source_api',
              owner: 'ammobinDOTca',
              repo: 'ammobin-api',
              oauthToken,
              output: apiSourceOutput
            })
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Build',
              project: cdkBuild,
              input: sourceOutput,
              extraInputs: [
                apiSourceOutput
              ],
              outputs: [
                cdkBuildOutput,
                apiBuildOutput
              ],
            }),
            // 20200105 todo: build client + put in s3 sitebucket for NON-prod...
          ],
        },
        {
          stageName: 'DeployBetaCA',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'cdkDeployApi',
              project: cdkDeployApi,
              input: cdkBuildOutput,
              extraInputs: [
                apiBuildOutput
              ],
              outputs: [],
              runOrder: 1
            }),

            new codepipeline_actions.CodeBuildAction({
              actionName: 'cdkDeployCloudFront',
              project: cdkDeployCloudFront,
              input: cdkBuildOutput,
              extraInputs: [
                apiBuildOutput
              ],
              outputs: [],
              runOrder: 1
            }),

            new codepipeline_actions.LambdaInvokeAction({
              actionName: 'betaCAIntegTests',
              userParameters: {
                stage: 'beta', region: 'CA'
              },
              lambda: new PipelineLambdaInvoker(this, 'betaCAIntegTests', {
                role: betaTestInvokeRole as iam.Role,
                targetAccount: props.caBetaAWSAccountId,
                base: 'https://beta.ammobin.ca'
              }).function,
              runOrder: 2,
            })
            // todo: run test command after deploying....
            // should test page reachable, main page loads, can goto listing page, can do basic filter, can load filter page directly
          ],
        },
        {
          stageName: 'DeployProdCA',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'cdkDeployApi',
              project: cdkDeployProdApi,
              input: cdkBuildOutput,
              extraInputs: [
                apiBuildOutput
              ],
              outputs: [],
            }),

            new codepipeline_actions.CodeBuildAction({
              actionName: 'cdkDeployCloudFront',
              project: cdkDeployProdCloudFront,
              input: cdkBuildOutput,
              extraInputs: [
                apiBuildOutput
              ],
              outputs: [],
            }),
            // todo: run test command after deploying....
            // should test page reachable, main page loads, can goto listing page, can do basic filter, can load filter page directly
          ],
        },
      ],
    })

    // todo add billing alarms....
    // todo configure pipeline notification
  }
}
