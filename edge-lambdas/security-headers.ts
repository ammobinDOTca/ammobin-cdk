import { CloudFrontResponseEvent, Context, Callback } from 'aws-lambda'
// add some security headers to our page responses
// values taken from caddyfile in ammobin-compose
export function handler(event: CloudFrontResponseEvent, context: Context, cb: Callback) {
  const response = event.Records[0].cf.response

  response.headers = {
    // Enable HTTP Strict Transport Security (HSTS) to force clients to always connect via HTTPS
    'strict-transport-security': [{ key: 'Strict-Transport-Security', value: "max-age=31536000;" }],
    // # Enable cross-site filter (XSS) and tell browser to block detected attacks
    'x-xss-protection': [{ key: 'X-XSS-Protection', value: "1; mode=block" }],
    // # Prevent some browsers from MIME-sniffing a response away from the declared Content-Type
    'x-content-type-options': [{ key: 'X-Content-Type-Options', value: "nosniff" }],
    //# Disallow the site to be rendered within a frame(clickjacking protection)
    'x-frame-options': [{ key: 'X-Frame-Options', value: "DENY" }],
    'content-security-policy': [{
      key: 'Content-Security-Policy',
      value: "default-src 'self';script-src 'self' 'unsafe-inline' https://storage.googleapis.com; connect-src  'self';  style-src 'self' 'unsafe-inline';img-src 'self';" //  report-uri https://aws.ammobin.ca/api/content-security-report-uri" // dont bother reporting this, noise is not worth the bill
    }],
    'referrer-policy': [{ key: 'Referrer-policy', value: 'origin' }],
    ...response.headers
  }

  cb(null, response)
}
