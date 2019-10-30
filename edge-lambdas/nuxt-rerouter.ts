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
import { URL } from 'url'

export function handler(event: CloudFrontRequestEvent, context: Context, cb: Callback) {
  console.log(event)
  var request = event.Records[0].cf.request
  console.log('original request.uri', request.uri)
  const url = new URL(request.uri)
  // if not a nuxt static assets AND does not have an extension
  if (!request.uri.includes('/_nuxt/') && !url.pathname.includes('.')) {
    request.uri += '.html'
  }

  console.log('nuxt reroute request.uri', request.uri)

  cb(null, request)
}
