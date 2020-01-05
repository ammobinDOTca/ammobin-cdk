# ammobin-cdk

ammobin.ca rebuilt on AWS serverless technologies using AWS-CDK

![](https://raw.githubusercontent.com/ammobinDOTca/ammobin-cdk/master/aws%20ammobin.ca%20cdk.png)

# setup

- create aws account + configure cli (set region to ca-central-1)
- install node 12 + cdk

```
npm run build
cdk bootstrap
cdk deploy AmmobinCdkStack
cdk deploy AmmobinGlobalCdkStack
cdk deploy s3UploadStack
cdk deploy GrafanaIamStack (optional)
```

### undocumented work:

- custom name DNS validation
  - copy down acm dns validation check from build output
  - set up cname from api.<BASE DOMAIN> to 'Target Domain Name' from custom domains tab on api gateway. set a short TTL on it (for easier turn around time debugging if things go wrong))
- daily nuxt generate + s3 upload -> github pages + actions (see https://github.com/ammobinDOTca/s3-bucket/blob/master/.github/workflows/main.yml)
- elasticsearch endpoint for log exporter to send stuff to (see https://ramsay.xyz/2018/10/13/how-to-secure-elasticsearch-with-caddy.html)

---

# issues

## lambda size limit

ammobin-client is too large to be uploaded as a lambda

## why not ecs?

https://aws.amazon.com/elasticloadbalancing/pricing/ => \$20 a month before any network costs

---

# open todos

## todo params:

- base domain
- aws region (hardcoded to ca-central-1)
- site bucket needs to be configurable

## todo code:

- run nuxt within lambda -> remove images from zip
- cold starts for api/graphql lambdas (webpack helped a lot -> smaller packages, and 600ms reduced boot time)

