import { APIGatewayEvent, APIGatewayProxyResult } from 'aws-lambda'
import { resize } from 'imagemagick'
import { get as getHttp } from 'http'
import { get as getHttps } from 'https'
import { Binary } from 'aws-sdk/clients/sns'
async function resizeImage(url: string, width: number): Promise<{ contentType: string, body: Binary }> {
  const { srcData, contentType } = await new Promise((resolve, reject) => (url.startsWith('https') ? getHttps : getHttp)(url, (res) => {

    let img: any[] = []
    res.on('data', d => {
      img.push(d)
    })
    res.on('end', () => resolve({ srcData: Buffer.concat(img).toString('binary'), contentType: res.headers["content-type"] }))
    res.on('error', e => reject(e))
  }))



  return new Promise((resolve, reject) => resize({
    srcData,
    width
  }, function (err, body) {
    if (err) {
      return reject(err)
    }
    return resolve({
      contentType,
      body
    })
  }))
}


export async function handler(event: APIGatewayEvent) {
  console.log(JSON.stringify(event))
  // todo: check referrer and allow expected sites...
  const s = event.path.split('/')
  const width = parseInt(s[2].split('x')[1])
  const url = s.slice(3).join('/')
  const { contentType, body } = await resizeImage(url, width)
  return <APIGatewayProxyResult>{
    statusCode: 200,
    headers: {
      'Content-Type': contentType
    },
    body,
  }
}

