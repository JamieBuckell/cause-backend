const Responses = require('../../common/API_Responses')
const Dynamo = require('../../common/Dynamo')
const Hashing = require('../../common/Hashing')
const Functions = require('../../common/Functions')
const Notifications = require('../../common/Notifications')

const AWS = require('aws-sdk')
AWS.config.update({ region: 'eu-west-2' })
const cognito = new AWS.CognitoIdentityServiceProvider({
  apiVersion: '2016-04-18',
})

exports.handler = async (event, context, cb) => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) {
      return Responses._401({
        messages: {
          unauthorized: 'You are not authorized to view this section',
        },
      })
    }

    const { campaignId } = event.pathParameters
    // const campaignId = '6fd91723-9316-4502-99cb-0fc6399aed86';
    const userPoolId = process.env.USER_POOL_V2
    const donorsTableName = process.env.DONORS_TABLE
    const campaignDonorsTableName = process.env.CAMPAIGN_DONORS_TABLE
    const familiesTableName = process.env.FAMILIES_TABLE
    const organisationsTableName = process.env.ORGANISATIONS_TABLE
    const nomTableName = process.env.NOMINATORS_TABLE

    const counts = {
      donors: 0,
      subscribers: 0,
      admins: 0,
      organisations: 0,
      nominators: 0,
      families: 0,
      pledged: 0,
      allocated: 0,
      allocatedConfirmed: 0,
      hampersDropped: 0,
    }

    const donorParams = { TableName: donorsTableName }
    const allDonors = await Dynamo.scan(donorParams).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })

    if (allDonors.length) {
      counts.subscribers = allDonors.filter(
        (d) => d.subscribed === true && d.verified === true
      ).length
    }

    const organisationsParams = { TableName: organisationsTableName }
    const allOrganisations = await Dynamo.scan(organisationsParams).catch(
      (err) => {
        console.log('error in dynamo query', err)
        return Responses._400({ messages: err })
      }
    )
    counts.organisations = allOrganisations.length

    const nominatorsParams = { TableName: nomTableName }
    const allNominators = await Dynamo.scan(nominatorsParams).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })
    counts.nominators = allNominators.length

    const params = { TableName: familiesTableName }
    const allFamilies = await Dynamo.scan(params).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })
    counts.families = allFamilies.length

    counts.allocated = allFamilies.filter(
      (f) => f.status.indexOf('allocated-') >= 0
    ).length
    counts.allocatedConfirmed = allFamilies.filter(
      (f) => f.status.indexOf('allocated-confirmed') >= 0
    ).length

    const queryData = {
      IndexName: 'campaignRequest',
      KeyConditionExpression: 'campaignId = :campaignId',
      ExpressionAttributeValues: {
        ':campaignId': campaignId,
      },
    }
    const campaignDonors = await Dynamo.query(
      queryData,
      campaignDonorsTableName
    ).catch((err) => {
      console.log('error in dynamo query', err)
      return Responses._400({ messages: err })
    })

    if (campaignDonors.length) {
      const sum = campaignDonors.reduce((accumulator, object) => {
        return accumulator + object.numberOfFamilies
      }, 0)
      counts.pledged = sum

      const sumVerified = campaignDonors.reduce((accumulator, cd) => {
        const donor = allDonors.find((d) => d.requestId === cd.donorId)
        return donor && donor?.verified
          ? accumulator + cd.numberOfFamilies
          : accumulator
      }, 0)
      counts.pledgedVerified = sumVerified

      const donorIds = campaignDonors.map((d) => d.donorId)

      const mappedDonorsData = campaignDonors.map((cd) => {
        return Object.assign(
          cd,
          allDonors.find((d) => cd.donorId === d.requestId)
        )
      })

      counts.donors = mappedDonorsData.filter(
        (d) => donorIds.includes(d.requestId) && d.verified === true
      ).length
    }

    const cognitoParams = {
      GroupName: 'Admin',
      UserPoolId: userPoolId,
    }
    const congitoGroupUsers = await cognito
      .listUsersInGroup(cognitoParams)
      .promise()
    if (congitoGroupUsers.Users && congitoGroupUsers.Users.length) {
      counts.admins = congitoGroupUsers.Users.length
    }

    counts.hampersDropped = allFamilies.filter(
      (f) =>
        f?.receiveStatus &&
        (f.receiveStatus.indexOf('hamper-received') >= 0 ||
          f.receiveStatus.indexOf('direct-hamper') >= 0)
    ).length

    return Responses._200(counts)
  } catch (e) {
    console.log(`An unexpected error occurred ${e}`)
    return Responses._400({
      messages: { unexpected: 'An unexpected error occurred' },
    })
  }
}
