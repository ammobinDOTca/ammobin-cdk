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

---

# issues

## lambda size limit

ammobin-client is too large to be uploaded as a lambda

## cold start

give enough memory to lambda so that it will not reach the limit to service a request

## why not ecs?

https://aws.amazon.com/elasticloadbalancing/pricing/ => \$20 a month before any network costs

---

todo params:
stack region
base domain

todo
api + dynamo
-> handles single subtype (will need to update UI)
-> split routes into multiple lambdas (will help on cold boots)
log exporter

s3 upload of generated nuxt (code build?)

- sub route in s3 for different folders

logging + metrics

- export aws costing data? + graphs

blog post explaining all the mirgation stuff

- cloud front root domain
- nuxt lambda size

cost differences

sns vs sqs when writting to dynamo.... (1 event & queue or X events with sns
) -> sqs generates empty lambda invocations checking for messages...

good example: https://github.com/aws-samples/aws-cdk-changelogs-demo

clean up old assets on schedule

```
TODO: build client and copy
cd src/ammobin-api && npm run build && cd ../../ && npm run build && cdk deploy
```

note: lambda for nuxt is too slow....
-> generate + upload to s3 on schedule
-> created edge lambda to transform ammobin.ca/about -> s3bucket/about.html (needed to fix queries)
