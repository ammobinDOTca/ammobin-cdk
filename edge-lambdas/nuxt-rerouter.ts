import { CloudFrontRequestEvent, Context, Callback } from 'aws-lambda'

export function handler(event: CloudFrontRequestEvent, context: Context, cb: Callback) {
  const request = event.Records[0].cf.request

  // if not a nuxt static assets AND does not have an extension
  //(assumes that pathname wont include a.before the last part, cant convert to php or perl later...)
  if (!request.uri.startsWith('/_nuxt/') &&
    (request.uri.startsWith('/en') || request.uri.startsWith('/fr')) &&
    !request.uri.endsWith('.html')) {
    request.uri += '.html'
  } else if (['/about', '/centerfire', '/shotgun', '/rimfire', '/reloading'].some(p => request.uri.startsWith(p))) {
    // re-route old request to english
    request.uri = '/en' + request.uri

    if (request.querystring) {
      const query = request.querystring.split('&').reduce((m, s) => {
        const fpp = s.split('=')
        m[fpp[0]] = fpp[1]
        return m
      }, {})


      if (query['subType']) {
        request.uri += '/' + query['subType']
        // todo: make 3XX redirect instead?
      } else if (query['calibre']) {
        request.uri += '/' + query['calibre']

      }
    }
    request.uri += '.html'


  }
  cb(null, request)
}
