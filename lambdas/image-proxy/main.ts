import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda'
import { resize } from 'imagemagick'
import { get as getHttp } from 'http'
import { get as getHttps } from 'https'

const { stage, region } = process.env
let DOMAIN = ''
if (stage === 'beta') {
  DOMAIN = 'beta.'
}
if (region === 'CA') {
  DOMAIN += 'ammobin.ca'
} else if (region === 'US') {
  DOMAIN += 'ammobin.us'
} else {
  throw new Error('unknown region:' + region)
}

async function resizeImage(url: string, width: number): Promise<{ contentType: string, body: any }> {
  const { srcData, contentType } = await new Promise<any>((resolve, reject) => (url.startsWith('https') ? getHttps : getHttp)(url, (res) => {
    // todo: assert content type + size + timeouts

    const contentType = res.headers["content-type"] || 'content-type not set'

    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(contentType)) {
      res.resume()
      return reject({ statusCode: 400, body: 'invalid content-type: ' + contentType })
    }
    const { statusCode } = res
    if (statusCode !== 200) {
      res.resume()
      return reject({ statusCode: 502, body: 'non-200 HTTP response received: ' + statusCode })
    }

    let img: any[] = []
    res.on('data', d => {
      img.push(d)
    })
    res.on('end', () => resolve({ srcData: Buffer.concat(img), contentType }))
    res.on('error', e => reject({ statusCode: 502, body: `image request errored: ${e.name} ${e.message}` }))
    res.on('aborted', e => reject({ statusCode: 502, body: `image request aborted: ${e.name} ${e.message}` }))
  }))


  // resize wants it's input/output buffers in binary
  return new Promise((resolve, reject) => resize({
    srcData,
    width
  }, function (err, body) {
    if (err) {
      return reject(err)
    }
    return resolve({
      contentType,
      body: Buffer.from(body, 'binary').toString('base64') // but apigateway likes base64
    })
  }))
}


export async function handler(event: APIGatewayEvent) {
  console.log(JSON.stringify(event))

  const { Referrer } = event.headers
  //todo: make this configurable....
  if (Referrer && ![DOMAIN, 'localhost', '127.0.0.1'].some(allowedDomain =>
    Referrer.endsWith(allowedDomain))) {
    return <APIGatewayProxyResult>{
      statusCode: 403,
      body: `${Referrer} is not allowed to load images`
    }
  }

  // also handle lambda function url events
  const s = (event.path||(event as any).rawPath).split('/')
  if (s.length < 3) {
    return <APIGatewayProxyResult>{
      statusCode: 404,
      body: JSON.stringify({ message: `invalid path ${event.path}.` })
    }
  }

  const width = parseInt(s[2].split('x')[1])
  const url = s.slice(3).join('/')
  try {
    const { contentType, body } = await resizeImage(url, width)
    return <APIGatewayProxyResult>{
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'max-age=31536000'
      },
      body,
      isBase64Encoded: true
    }
  } catch (e: any) {
    console.error(e)
    if (e && e.statusCode) {
      // return e // handled invalid request
      // return jnk to avoid repeat calls jacking up my cloudfront bill
      return <APIGatewayProxyResult>{
        statusCode: 204,
        headers: {
          'Content-Type': 'application/text',
          'Cache-Control': 'max-age=31536000'
        },
        body: ''
      }
    } else {
      throw e
    }

  }
}
// import { writeFileSync } from 'fs'
// handler({ path: '/images/x160/https://yt3.ggpht.com/a/AGF-l79xs_-7Y7Xn4ZSC72sueD2rs6U5YLJZxAcAGw=s48-c-k-c0xffffffff-no-rj-mo' } as any).then(f => writeFileSync('./foo.png', Buffer.from(f.body, 'base64'))).catch(e => console.error(e))
