import { CloudFrontRequestEvent, Context, Callback } from 'aws-lambda'

export function handler(event: CloudFrontRequestEvent, context: Context, cb: Callback) {
  const request = event.Records[0].cf.request
  console.log(request)

  // if not a nuxt static assets AND does not have an extension
  //(assumes that pathname wont include a.before the last part, cant convert to php or perl later...)
  if (!request.uri.startsWith('/_nuxt/') && (request.uri.startsWith('/en') || request.uri.startsWith('/fr')) && !request.uri.endsWith('.html')) {
    request.uri += '.html'
  }

  // todo: add custom headers for security + csp
  console.log('nuxt reroute request.uri', request.uri)

  cb(null, request)
}
