import { CloudWatchLogsEvent } from 'aws-lambda'
import { SecretsManager } from 'aws-sdk'
import { unzip } from 'zlib'
import { promisify } from 'util'

import { URL } from 'url'
import axios from 'axios'

const sm = new SecretsManager()

const region = process.env.REGION || 'unknown'
function post(url: URL, body) {
  //https://docs.fluentd.org/input/http#how-to-use-http-content-type-header
  url.pathname = `/ammobin.${region?.toLowerCase()}-aws`
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
    await Promise.all(msg.logEvents.map(le => post(esUrl, JSON.parse(le.message))))
    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}

