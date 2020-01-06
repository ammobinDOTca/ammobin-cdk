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

    const cdkBuild = new codebuild.PipelineProject(this, 'CdkBuild', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: 'npm install',
          },
          build: {
            commands: [
              'npm run build',
              'npm run cdk synth'
            ],
          },
        },
        artifacts: {
          'base-directory': 'cdk.out',
          files: [
            apiStackCFTemplate,
            globalStackCFTemplate,
          ],
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_14_1
      },
    });
    // const apiLambdaBuild = new codebuild.PipelineProject(this, 'LambdaBuild', {
    //   buildSpec: codebuild.BuildSpec.fromObject({
    //     version: '0.2',
    //     phases: {
    //       install: {
    //         commands: [
    //           'git clone https://github.com/ammobinDOTca/ammobin-api.git',
    //           'cd ammobin-api',
    //           'npm install',
    //         ],
    //       },
    //       build: {
    //         commands: 'npm run lambda-build',
    //       },
    //     },
    //     artifacts: {
    //       'base-directory': 'ammobin-api/lambda',
    //       files: [
    //         '*.js',
    //       ],
    //     },
    //   }),
    //   environment: {
    //     buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_NODEJS_10_14_1,
    //   },
    // });

    const sourceOutput = new codepipeline.Artifact();
    const cdkBuildOutput = new codepipeline.Artifact('CdkBuildOutput');
    const lambdaBuildOutput = new codepipeline.Artifact('LambdaBuildOutput');
    const oauthToken = SecretValue.secretsManager('my-github-token');

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
              outputs: [cdkBuildOutput],
            }),
            // 20200105 todo: build client + put in s3 sitebucket for NON-prod...
          ],
        },
        {
          stageName: 'DeployProdCA',
          actions: [
            ...[
              // apiStackCFTemplate, TODO restore
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
