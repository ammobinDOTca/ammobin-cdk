/*{
  "Records": [
    {
      "cf": {
        "config": {
          "distributionId": "EDFDVBD6EXAMPLE"
        },
        "request": {
          "clientIp": "2001:0db8:85a3:0:0:8a2e:0370:7334",
          "method": "GET",
          "uri": "/picture.jpg",
          "headers": {
            "host": [
              {
                "key": "Host",
                "value": "d111111abcdef8.cloudfront.net"
              }
            ],
            "user-agent": [
              {
                "key": "User-Agent",
                "value": "curl/7.51.0"
              }
            ]
          }
        }
      }
    }
  ]
}*/

import { CloudFrontRequestEvent, Context, Callback } from 'aws-lambda'

export function handler(event: CloudFrontRequestEvent, context: Context, cb: Callback) {
  const request = event.Records[0].cf.request
  console.log(request)

  // if not a nuxt static assets AND does not have an extension
  //(assumes that pathname wont include a.before the last part, cant convert to php or perl later...)
  if (!request.uri.includes('/_nuxt/') && !request.uri.includes('.')) {
    request.uri += '.html'
  }
  console.log('nuxt reroute request.uri', request.uri)

  cb(null, request)
}
