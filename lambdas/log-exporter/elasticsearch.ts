import { CloudWatchLogsEvent } from 'aws-lambda'
import { SecretsManager } from 'aws-sdk'
import { unzip } from 'zlib'
import { promisify } from 'util'

import winston = require('winston');
const Elasticsearch = require('winston-elasticsearch')

let logger: winston.Logger

export async function handler(event: CloudWatchLogsEvent) {
  if (!logger) {
    const sm = new SecretsManager()
    const result = await sm.getSecretValue({ SecretId: process.env.ES_URL_SECRET_ID || '' }).promise()


    logger = winston.createLogger({
      transports: [
        new Elasticsearch({
          level: 'info',
          flushInterval: 10,
          buffering: false,
          ensureMappingTemplate: true,
          mappingTemplate: {
            "mappings": {
              "_source": { "enabled": true },
              "properties": {
                "@timestamp": { "type": "date" },
                "@version": { "type": "keyword" },
                "message": { "type": "object", "dynamic": true },
                "severity": { "type": "keyword", "index": true },
                "fields": {
                  "dynamic": true,
                  "properties": {}
                }
              }
            }
          },
          indexPrefix: 'ammobin.ca-aws',
          clientOpts: {
            node: result.SecretString || '',
            compression: 'gzip'
          }
        }) as any,
      ]
    });
    logger.on('error', function (err) {
      console.error('unexpected error in winston logger', err)
      throw err
    });

  }
  const buff = await promisify(unzip)(Buffer.from(event.awslogs.data, "base64"))
  try {
    const msg = JSON.parse((buff as Buffer).toString())
    if (typeof msg === 'string') {
      console.error('[ERROR]: msg is a sting....skipping', msg)
      return true;
    }
    await Promise.all(msg.logEvents.map(le => new Promise((resolve, reject) => logger.info(JSON.parse(le.message).message, (err) => err ? reject(err) : resolve()))))
    return true
  } catch (e) {
    console.error(e)
    throw e
  }
}
