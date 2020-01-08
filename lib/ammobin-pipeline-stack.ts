import codebuild = require('@aws-cdk/aws-codebuild');
import codepipeline = require('@aws-cdk/aws-codepipeline');
import codepipeline_actions = require('@aws-cdk/aws-codepipeline-actions');
import lambda = require('@aws-cdk/aws-lambda');
import { App, Stack, StackProps, SecretValue } from '@aws-cdk/core';

export interface PipelineStackProps extends StackProps {
}

export class AmmobinPipelineStack extends Stack {
  constructor(app: App, id: string, props: PipelineStackProps) {
    super(app, id, props);

    const apiStackCFTemplate = 'AmmobinCdkStack.template.json'
    const globalStackCFTemplate = 'AmmobinGlobalCdkStack.template.json'
    const API_SOURCE = 'ammobinApi'

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [

              'npm install',
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
              `apiCode=$CODEBUILD_SRC_DIR_${API_SOURCE} npm run cdk synth`
            ],
          },
          // todo: deploy????
        },
        artifacts: {
          'base-directory': 'cdk.out',
          files: [
            apiStackCFTemplate,
            globalStackCFTemplate,
            // assets?
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_14_1
      },
    });


    const sourceOutput = new codepipeline.Artifact('ammobinCdk');
    const apiSourceOutput = new codepipeline.Artifact(API_SOURCE);
    const cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput');
    const oauthToken = SecretValue.secretsManager('github-auth-token'); // should manually create beforehand. pipeline wants to make api calls with this token before one has a chance to populate it

    new codepipeline.Pipeline(this, 'Pipeline', {
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
            // new codepipeline_actions.CodeBuildAction({
            //   actionName: 'Lambda_Build',
            //   project: apiLambdaBuild,
            //   input: sourceOutput,
            //   outputs: [lambdaBuildOutput],
            // }),
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CDK_Build',
              project: cdkBuild,
              input: sourceOutput,
              extraInputs: [
                apiSourceOutput
              ],
              outputs: [cdkBuildOutput],
            }),
            // 20200105 todo: build client + put in s3 sitebucket for NON-prod...
          ],
        },
        {
          stageName: 'DeployProdCA',
          actions: [
            ...[
              // apiStackCFTemplate, TODO restore?
              globalStackCFTemplate
            ].map(s => {
              const stackName = s.split('.')[0]

              return new codepipeline_actions.CloudFormationCreateUpdateStackAction({
                actionName: stackName + '_CFN_Deploy',
                templatePath: cdkBuildOutput.atPath(s),
                stackName,
                adminPermissions: true,
                // account: PROD_ACCOUNT,
                parameterOverrides: {
                  publicUrl: 'aws.ammobin.ca', // todo: convert to ammobin.ca soon
                  stage: 'prod'
                },
                extraInputs: [
                  // lambdaBuildOutput
                  cdkBuildOutput
                ],
              })
            })
          ],
        },
      ],
    });
  }
}
