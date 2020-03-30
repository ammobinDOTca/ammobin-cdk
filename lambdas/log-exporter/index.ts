import { CloudWatchLogsEvent } from 'aws-lambda'
import { SecretsManager } from 'aws-sdk'
import { unzip } from 'zlib'
import { promisify } from 'util'

// import { request, RequestOptions } from 'https' // todo: use http2

import { URL } from 'url'
import axios from 'axios'

// function posts(url: URL, body) {
//   // https://docs.fluentd.org/v/0.12/input/http
//   url.pathname = '/ammobin.ca-aws'
//   const requestBody = 'json=' + JSON.stringify(body)

//   const options: RequestOptions = {
//     method: 'POST',
//     headers: {
//       'Content-Type': 'application/json',
//       'Content-Length': requestBody.length,
//       'ammobin-aws': 'yup'
//     },
//     timeout: 2000
//   }

//   return new Promise((resolve, reject) => {
//     try {
//       const req = request(url, options, res => {
//         const { statusCode } = res
//         console.log(statusCode)

//         res.on('data', data => {
//           resolve({
//             statusCode,
//             data
//           })
//         })


//         req.on('error', error => {
//           reject({
//             statusCode,
//             error
//           })
//         })


//         req.write(requestBody)
//         req.end()
//       })
//     } catch (e) {
//       reject(e)
//     }
//   })
// }
const sm = new SecretsManager()


function post(url: URL, body) {
  url.pathname = '/ammobin.ca-aws'
  return axios.post(url.toString(), body)
}
export async function handler(event: CloudWatchLogsEvent) {

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

