const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');
const Notifications = require('../common/Notifications');
const moment = require('moment-timezone');

exports.handler = async event => {
  try {
    const raw = event.pathParameters?.emailAddress ?? '';
    const emailAddress = (raw.includes('@') ? raw : decodeURIComponent(raw)).toLowerCase();
    const { v, campaignId } = event.queryStringParameters ?? {};
    const admin = Functions.hasPermission(event, 'Admin');
    if (!emailAddress || (!admin && !v)) return Responses._400({ messages: { error: 'Invalid verification link' } });
    const salt = process.env.HASHING_SALT;
    const prefix = process.env.HASHING_PREFIX;
    const table = process.env.SUBSCRIBERS_TABLE;
    const subscribers = await Dynamo.query({
      KeyConditionExpression: '#pk= :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': emailAddress, ':sk': prefix },
    }, table);
    const subscriber = subscribers[0];
    const subscriberAuthorized = !!subscriber && (admin || Hashing.compare(subscriber.SK.slice(prefix.length), { salt, hashedpassword: v }));
    let verified = false;
    const timestamp = moment().tz(process.env.TIMEZONE).format(process.env.DATE_FORMAT);
    if (subscriberAuthorized) {
      if (!subscriber.verified || subscriber.pendingSubscription) {
        subscriber.verified = true;
        subscriber.dateVerified = timestamp;
        if (subscriber.pendingSubscription) {
          subscriber.subscribed = true;
          subscriber.dateSubscribed = timestamp;
          subscriber.dateUnsubscribed = '';
          delete subscriber.pendingSubscription;
          delete subscriber.status;
        }
        await Dynamo.write(subscriber, table);
      }
      verified = true;
    }
    // Standalone subscriptions do not need a campaign. Donor verification only
    // touches the explicitly named campaign and exact email key.
    if (campaignId && campaignId !== 'undefined') {
      const mainTable = process.env.MAIN_DYNAMO_TABLE;
      const campaign = await Dynamo.get({ PK: campaignId, SK: 'A' }, mainTable);
      if (campaign.status !== 'deleted' && new Date() <= new Date(campaign.campaignDetails?.registrationClosed)) {
        const donors = await Dynamo.query({
          KeyConditionExpression: '#pk= :pk AND #sk= :sk',
          ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
          ExpressionAttributeValues: { ':pk': campaignId, ':sk': `EMAIL#D#${emailAddress}` },
        }, mainTable);
        for (const donor of donors) {
          if (donor.status === 'deleted') continue;
          const donorToken = donor.emailVerification?.hash;
          const authorized = admin || subscriberAuthorized || (donorToken && Hashing.compare(donorToken.startsWith(prefix) ? donorToken.slice(prefix.length) : donorToken, { salt, hashedpassword: v }));
          if (!authorized) continue;
          verified = true;
          if (donor.emailVerification?.verified) continue;
          donor.emailVerification = { ...donor.emailVerification, verified: true, dateVerified: timestamp };
          await Dynamo.write(donor, mainTable);
          const template = await Functions.getEmailTemplate('donorVerified', {
            familyData: donor.familyDetails.request, donorData: { ...donor.donorDetails, email: emailAddress },
          });
          await Notifications.sendTransactionalEmail({ ...template, ToAddresses: [emailAddress] });
        }
      }
    }
    return verified
      ? Responses._200({ messages: { success: 'Your email address has successfully been verified.' } })
      : Responses._400({ messages: { error: 'Invalid verification link' } });
  } catch (error) {
    console.log('Verification failed', error);
    return Responses._400({ messages: { unexpected: 'An unexpected error occurred. Please try again later' } });
  }
};
