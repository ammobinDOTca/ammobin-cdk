import { CloudFrontRequestEvent, Context, Callback } from 'aws-lambda'

export function handler(event: CloudFrontRequestEvent, context: Context, cb: Callback) {
  const request = event.Records[0].cf.request

  // if not a nuxt static assets AND does not have an extension
  //(assumes that pathname wont include a.before the last part, cant convert to php or perl later...)
  if (!request.uri.startsWith('/_nuxt/') &&
    (request.uri.startsWith('/en') || request.uri.startsWith('/fr')) &&
    !request.uri.endsWith('.html')) {
    request.uri += '.html'
  } else if (['/about', '/centerfire', '/shotgun', '/rimfire', '/reloading'].some(p => p === request.uri)) {
    // re-route old request to english
    request.uri = '/en' + request.uri
  }

  // todo: add custom headers for security + csp

  cb(null, request)
}
