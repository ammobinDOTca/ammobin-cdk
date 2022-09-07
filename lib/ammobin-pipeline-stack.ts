import codebuild = require('@aws-cdk/aws-codebuild')
import codepipeline = require('@aws-cdk/aws-codepipeline')
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions')
import { App, Stack, StackProps, SecretValue, Arn } from '@aws-cdk/core'
import iam = require('@aws-cdk/aws-iam')
import { Bucket } from '@aws-cdk/aws-s3'
import { Duration, } from "@aws-cdk/core"
import { Function, Runtime, AssetCode } from '@aws-cdk/aws-lambda'
import { PolicyStatement, Role, ManagedPolicy, ServicePrincipal } from '@aws-cdk/aws-iam'

import { CrossAccountDeploymentRoles } from './CrossAccountDeploymentRole'
import { LOG_RETENTION, serviceName, Stage, Region, TEST_LAMBDA_NAME, RUNTIME } from './constants'
import { PipelineInvokeUserParams } from '../lambdas/pipeline/test-invoker'
import { getAccountForRegionAndStage, regionToAWSRegion } from './helper'

export interface PipelineStackProps extends StackProps {

  regions: Region[]
  stages: Stage[]

}
// todo add client build + cloudflare worker publish

export class AmmobinPipelineStack extends Stack {
  //https://winterwindsoftware.com/serverless-cicd-pipelines-with-aws-cdk/

  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props)
    //https://docs.aws.amazon.com/codebuild/latest/userguide/available-runtimes.html
    const API_SOURCE = 'ammobinApi'
    const nodejs = 16
    const buildImage = 'aws/codebuild/amazonlinux2-x86_64-standard:4.0' //codebuild.LinuxBuildImage.STANDARD_4_0 // todo arm
    const CDK_BUILD_OUT = 'CdkBuildOutput'
    const API_BUILD_OUT = 'ApiBuildOutput'


    const { stages, regions } = props
    const pipelineRoles: {
      [stage in Stage]: {
        [region in Region]: {
          deploy: iam.IRole
          test: iam.IRole
        }
      }
    } = stages.reduce((map, stage) => {
      map[stage] = {} as any
      regions.forEach(region => {
        const account = getAccountForRegionAndStage(region, stage)
        if (account) {
          map[stage][region] = {
            deploy: iam.Role.fromRoleArn(this, `deploy${stage}${region}Role`, CrossAccountDeploymentRoles.getDeployRoleArnForService(serviceName, stage, region, account)),
            test: iam.Role.fromRoleArn(this, `test${stage}${region}Role`, CrossAccountDeploymentRoles.getDeployRoleArnForService(serviceName, stage, region, account)),
          }
        }
      })
      return map
    }, {} as {
      [stage in Stage]: {
        [region in Region]: {
          deploy: iam.IRole
          test: iam.IRole
        }
      }
    })

    // role used in beta account to deploy stack there


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
      resources:
        stages.reduce((lst, stage) => {
          regions.forEach(region => {
            const roles = pipelineRoles[stage][region]
            if (roles) {
              lst.push(pipelineRoles[stage][region].deploy.roleArn)
            }
          })
          return lst
        }, [] as string[])
    }))

    const s3BuildCache = new Bucket(this, 's3BuildCache', {
      // todo: expire build cache?
    })
    s3BuildCache.addLifecycleRule({ expiration: Duration.days(30) })

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs },
            commands: [
              'npm ci',
              'npm run postinstall',
              `cd $CODEBUILD_SRC_DIR_${API_SOURCE}`,
              'npm ci',
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
            'node_modules/**/*',
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
    })

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
              stage=${stage} site_region=${region} region=${regionToAWSRegion(region)} apiCode=$CODEBUILD_SRC_DIR_${API_BUILD_OUT} node node_modules/aws-cdk/bin/cdk.js deploy ${stack}`,
              ],
            },
          },
        }),
        environment: {
          buildImage
        },
        role: pipelineDeployToBetaAccountRole, // important.....(need custom role to allow us to manually assume role in beta account)
      })
    }



    const sourceOutput = new codepipeline.Artifact('ammobinCdk')
    const apiSourceOutput = new codepipeline.Artifact(API_SOURCE)

    const cdkBuildOutput = new codepipeline.Artifact(CDK_BUILD_OUT)
    const apiBuildOutput = new codepipeline.Artifact(API_BUILD_OUT)

    const artifactBucket = new Bucket(this, 'artifactBucket', {})
    artifactBucket.addLifecycleRule({ expiration: Duration.days(30) })


    const oauthToken = SecretValue.secretsManager('github-auth-token') // should manually create beforehand. pipeline wants to make api calls with this token before one has a chance to populate it


    const lambdaAssumeRole = new Role(this, 'lambdaAssumRole', {
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')],
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
    })

    lambdaAssumeRole.addToPolicy(new PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: stages.reduce((lst, stage) => {
        regions.forEach(region => {
          const roles = pipelineRoles[stage][region]
          if (roles) {
            lst.push(pipelineRoles[stage][region].test.roleArn)
          }
        })
        return lst
      }, [] as string[])
    }))

    lambdaAssumeRole.addToPolicy(new PolicyStatement({
      actions: [
        "codepipeline:PutJobSuccessResult",
        "codepipeline:PutJobFailureResult"
      ],
      resources: [
        '*' // todo: ref pipeline arn?
      ]
    }))

    const testInvokeLambda = new Function(this, 'pipelineTestInvoker', {
      role: lambdaAssumeRole,
      runtime: RUNTIME,
      timeout: Duration.minutes(5),
      logRetention: LOG_RETENTION,
      handler: 'test-invoker.handler',
      code: new AssetCode('./dist/lambdas/pipeline')
    })


    function getIntegTestArn({ region, stage }: { region: Region, stage: Stage }): string {
      const awsRegion = regionToAWSRegion(region)
      const account = getAccountForRegionAndStage(region, stage)
      return `arn:aws:lambda:${awsRegion}:${account}:function:${TEST_LAMBDA_NAME}`
    }

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      role: pipelineRole,
      restartExecutionOnUpdate: true,
      artifactBucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.GitHubSourceAction({
              actionName: 'github_source_cdk',
              owner: 'ammobinDOTca',
              repo: 'ammobin-cdk',
              branch: 'master', // todo: restore to master once this is stable
              oauthToken,
              output: sourceOutput,
            }),
            new codepipeline_actions.GitHubSourceAction({
              actionName: 'github_source_api',
              owner: 'ammobinDOTca',
              repo: 'ammobin-api',
              oauthToken,
              output: apiSourceOutput
            })
            // todo add client pkg
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
            // todo wrangler build
          ],
        },
        ...stages.reduce((pipelineStages, stage) => {
          return pipelineStages.concat(
            regions.reduce((lst, region) => {
              const actions: codepipeline.IAction[] = [
                new codepipeline_actions.CodeBuildAction({
                  actionName: 'cdkDeployApi',
                  project: generateDeployToAccountBuild('deployApi', pipelineRoles[stage][region].deploy.roleArn, stage, region, 'AmmobinCdkStack'),
                  input: cdkBuildOutput,
                  extraInputs: [
                    apiBuildOutput
                  ],
                  outputs: [],
                  runOrder: 1
                }),

                new codepipeline_actions.CodeBuildAction({
                  actionName: 'cdkDeployCloudFront',
                  project: generateDeployToAccountBuild('deployCloudFront', pipelineRoles[stage][region].deploy.roleArn, stage, region, 'AmmobinGlobalCdkStack'),
                  input: cdkBuildOutput,
                  extraInputs: [
                    apiBuildOutput
                  ],
                  outputs: [],
                  runOrder: 1
                }),

                // todo wrangler publish
              ]

              actions.push(new codepipeline_actions.LambdaInvokeAction({
                actionName: `${stage}${region}IntegTests`,
                userParameters: <PipelineInvokeUserParams>{
                  base: `https://${stage === 'prod' ? '' : stage.toLowerCase() + '.'}ammobin.${region.toLowerCase()}`,
                  roleArn: pipelineRoles[stage][region].test.roleArn,
                  targetFunctionArn: getIntegTestArn({ stage, region }),
                  targetRegion: regionToAWSRegion(region)
                },
                lambda: testInvokeLambda,
                runOrder: 2,
              }))



              return lst.concat({
                stageName: `Deploy${stage}${region}`,
                actions,

              })
            }, [] as codepipeline.StageProps[])
          )
        }, [] as codepipeline.StageProps[]),
      ],
    })


    // todo configure pipeline notification
  }
}
