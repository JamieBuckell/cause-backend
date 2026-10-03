const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Hashing = require('../common/Hashing');
const Functions = require('../common/Functions');
const Notifications = require('../common/Notifications');
const { nanoid } = require('nanoid');
const moment = require('moment-timezone');

exports.handler = async event => {
  try {
    const parsed = event.email ? event : JSON.parse(event.body);
    const errors = await Functions.validateSubmission(parsed, [
      { key: 'firstname', required: true, errorMsg: 'First name is required' },
      { key: 'lastname', required: true, errorMsg: 'Last name is required' },
      { key: 'email', required: true, type: 'email', errorMsg: 'Email is required' },
    ]);
    if (Object.keys(errors).length) return Responses._400({ messages: errors });
    const email = parsed.email.trim().toLowerCase();
    const table = process.env.SUBSCRIBERS_TABLE;
    const prefix = process.env.HASHING_PREFIX;
    const rows = await Dynamo.query({
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': email, ':sk': prefix },
    }, table);
    const existing = rows[0];
    const timestamp = moment().tz(process.env.TIMEZONE).format(process.env.DATE_FORMAT);
    // Do not resubscribe an existing address until its owner verifies the link.
    const subscriber = existing ? { ...existing, pendingSubscription: true } : {
      PK: email, SK: `${prefix}${nanoid(12)}`, firstName: parsed.firstname.trim(), lastName: parsed.lastname.trim(),
      company: String(parsed.company ?? ''), telephone: String(parsed.telephone ?? ''),
      dateAdded: timestamp, subscribed: false, verified: false, pendingSubscription: true,
    };
    await Dynamo.write(subscriber, table);
    const token = Hashing.hash(subscriber.SK.slice(prefix.length), process.env.HASHING_SALT).hashedpassword;
    const link = `${process.env.APP_URL}/subscription/verify/${encodeURIComponent(email)}?v=${encodeURIComponent(token)}`;
    await Notifications.sendTransactionalEmail({
      ToAddresses: [email], subject: 'Confirm your CAUSE Foundation subscription',
      pageTitle: 'Confirm your subscription',
      pageContent: `Please <a href="${link}">verify your email address</a> to receive CAUSE Foundation updates.`,
    });
    return Responses._200({ messages: { success: 'Please check your email to confirm your subscription' } });
  } catch (error) {
    console.log('Subscription failed', error);
    return Responses._400({ messages: { unexpected: 'An unexpected error occurred' } });
  }
};
