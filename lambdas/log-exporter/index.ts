import { CloudWatchLogsEvent } from 'aws-lambda'
import { SecretsManager } from 'aws-sdk'
import { unzip } from 'zlib'
import { promisify } from 'util'

import { request, RequestOptions } from 'https' // todo: use http2

import { URL } from 'url'

function post(url: URL, body) {

  const requestBody = JSON.stringify(body)

  const options: RequestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': requestBody.length
    },
  }

  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      const { statusCode } = res

      res.on('data', data => {
        resolve({
          statusCode,
          data
        })
      })


      req.on('error', error => {
        reject({
          statusCode,
          error
        })
      })


      req.write(requestBody)
      req.end()
    })
  })
}

export async function handler(event: CloudWatchLogsEvent) {

  const sm = new SecretsManager()
  const esUrl = new URL((await sm.getSecretValue({ SecretId: process.env.ES_URL_SECRET_ID || '' }).promise()).SecretString || '')

  const buff = await promisify(unzip)(Buffer.from(event.awslogs.data, "base64"))
  try {
    const msg = JSON.parse((buff as Buffer).toString())
    if (typeof msg === 'string') {
      console.error('[ERROR]: msg is a sting....skipping', msg)
      return true
    }
    await Promise.all(msg.logEvents.map(le => post(esUrl, JSON.parse(le.message).message)))
    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}
