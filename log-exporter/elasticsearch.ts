import { CloudWatchLogsEvent } from 'aws-lambda'
import { SecretsManager } from 'aws-sdk'

const winston = require('winston');
const Elasticsearch = require('winston-elasticsearch')

let logger

export async function handler(event: CloudWatchLogsEvent) {
  console.log(JSON.stringify(event))
  if (!logger) {
    const sm = new SecretsManager()
    const result = await sm.getSecretValue({ SecretId: process.env.ES_URL_SECRET_ID || '' }).promise()


    logger = winston.createLogger({
      transports: [
        new Elasticsearch({
          level: 'info',
          indexPrefix: 'ammobin.ca-aws',
          clientOpts: {
            node: result.SecretString || ''
          }
        }) as any
      ]
    });
  }

  const lg = event.awslogs.data
  try {
    logger.info(JSON.parse(lg))
  } catch (e) {
    console.error(e)
  }


  return true
}
