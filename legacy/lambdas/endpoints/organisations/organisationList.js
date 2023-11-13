const Responses = require('../../common/API_Responses')
const Dynamo = require('../../common/Dynamo')
const Functions = require('../../common/Functions')

const AWS = require('aws-sdk')
const SES = new AWS.SES()

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) {
      return Responses._401({
        messages: {
          unauthorized: 'You are not authorized to view this section',
        },
      })
    }

    const requestId = context.awsRequestId // Change this so that we are generating our own ID

    const parsed = event.emailAddress ? event : JSON.parse(event.body)

    const tableName = process.env.ORGANISATIONS_TABLE

    const params = { TableName: tableName }
    let organisationsData = await Dynamo.scan(params).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })

    if (!organisationsData) {
      return Responses._400({ message: 'Failed to retrieve all via scan' })
    }

    organisationsData = organisationsData.filter((o) => o.status !== 'deleted')

    return Responses._200({ ...organisationsData })
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`)
    return Responses._400({
      messages: { unexpected: 'An unexpected error occurred' },
    })
  }
}
