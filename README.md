# Useful commands

- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

1. create account
   configure cli
   -> set region to ca-central-1
   npm run build
   cdk bootstrap
   cdk deploy
   -> copy down acm dns validation check
   -> set up cname from client.aws.ammobin.ca to 'Target Domain Name' from custom domains tab on api gateway. set a short TTL on it (for easier turn around time debugging if things go wrong)

todo params:
region
base domain

queue
api + dynamo
refresher
log exporter

merge api + client changes to normal repo
develop install strat for min nuxt uploads
s3 upload of generated nuxt static assets

find way to serve static route assets (like robot.txt, sitemap, favicon)
-> edge lambda
custom public domain for cloudfront

logging + metrics

blog post explaining all the mirgation stuff

- cloud front root domain
- nuxt lambda size

cost differences

sns vs sqs when writting to dynamo.... (1 event & queue or X events with sns
) -> sqs generates empty lambda invocations checking for messages...

good example: https://github.com/aws-samples/aws-cdk-changelogs-demo
