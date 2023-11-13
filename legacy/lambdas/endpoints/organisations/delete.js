const Responses = require('../../common/API_Responses')
const Dynamo = require('../../common/Dynamo')
const Hashing = require('../../common/Hashing')
const Functions = require('../../common/Functions')

const moment = require('moment-timezone')

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) {
      return Responses._401({
        messages: {
          unauthorized: 'You are not authorized to view this section',
        },
      })
    }
    const { organisationId } = event.pathParameters
    const timezone = process.env.TIMEZONE
    const dateFormat = process.env.DATE_FORMAT

    const organisationsTableName = process.env.ORGANISATIONS_TABLE

    const organisationData = await Dynamo.get(
      {
        requestId: organisationId,
      },
      organisationsTableName
    ).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })

    if (!organisationData.requestId) {
      return Responses._400({
        messages: { unexpected: 'Organisation not found' },
      })
    }
    const timeStamp = moment(new Date().getTime())
      .tz(timezone)
      .format('YYYYMMDDHHmmss')

    const updateData = {
      ...organisationData,
    }
    updateData.status = 'deleted'
    updateData.reference = `${updateData.reference}-DELETED-${timeStamp}`

    await Dynamo.write(updateData, organisationsTableName).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })

    /* Do Not Pysically Delete

         await Dynamo.delete(
            { "requestId": organisationData.requestId }, 
            organisationsTableName
        ).catch(err => {
            console.log('error in dynamo query', err);
            return Responses._400({ messages: err });
        });
        */

    return Responses._200({
      messages: { success: 'Organisations deleted successfully' },
    })
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`)
    return Responses._400({
      messages: { unexpected: 'An unexpected error occurred' },
    })
  }
}
