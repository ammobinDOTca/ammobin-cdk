var AWS = require('aws-sdk')

AWS.config.update({
  region: 'ca-central-1',
  endpoint: 'http://localhost:8000',
})

var docClient = new AWS.DynamoDB.DocumentClient()

console.log('Importing movies into DynamoDB. Please wait.')
;[
  {
    id: 'center_5.56_tenda',
    items: [{ f: 'ass' }, { a: 'assss' }],
  },
  {
    id: 'center_5.56_ct',
    items: [{ q: 'ass' }, { a: 'assss' }],
  },
  {
    id: 'center_5.56_alfart',
    items: [{ f: 'ass' }, { t: 'assss' }],
  },
].forEach(function(Item) {
  var params = {
    TableName: 'items',
    Item,
  }

  docClient.put(params, function(err, data) {
    if (err) {
      console.error('Unable to add movie', Item.id, '. Error JSON:', JSON.stringify(err, null, 2))
    } else {
      console.log('PutItem succeeded:', Item.id)
    }
  })
})
