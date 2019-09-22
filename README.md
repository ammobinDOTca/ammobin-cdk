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
