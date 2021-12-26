/**
 * basic node js http server to wrap the lambda handlerr
 * allows for this function to be deployed as a docker container anywhere
 */
import { createServer, RequestListener } from 'http'

process.env.region = process.env.region || 'CA'
process.env.stage = process.env.stage || 'PROD'

import { handler } from './main.js'


const requestListener: RequestListener = async function ({ headers, url }, res) {
  if (url === '/ping') {
    res.writeHead(200)
    res.end('OK')
    return
  }


  const { statusCode, headers: resultHeaders, body, } = await handler({
    headers,
    path: url
  } as any)

  for (let key in resultHeaders) {
    res.setHeader(key, resultHeaders[key]?.toString())
  }

  res.writeHead(statusCode)
  res.end(body, 'base64')
}

const server = createServer(requestListener)
server.listen(process.env.PORT || 8080)
console.log(`Running on ${process.env.PORT || 8080}`)
