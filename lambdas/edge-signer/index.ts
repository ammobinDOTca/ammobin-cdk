// export { handler } from 'edge-lambda-url-authorizer'
import { handler as fn } from 'edge-lambda-url-authorizer'


export function handler(event,context,cb){
    console.log(JSON.stringify(event),context)
    return fn(event,context,cb)
}