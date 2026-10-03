const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Functions = require('../common/Functions');

exports.handler = async event => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) return Responses._401({ messages: { unauthorized: 'Admin access is required' } });
    const parsed = event.key ? event : JSON.parse(event.body);
    const errors = await Functions.validateSubmission(parsed, ['key', 'subject', 'pageContent'].map(key => ({ key, required: true, errorMsg: `${key} is required` })));
    if (Object.keys(errors).length) return Responses._400({ messages: errors });
    const key = String(parsed.key).trim();
    const table = process.env.EMAIL_TEMPLATES_TABLE;
    const existing = await Dynamo.query({
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'PK' }, ExpressionAttributeValues: { ':pk': key },
    }, table);
    if (existing.length) return Responses._400({ messages: { duplicate: 'Template key already exists' } });
    const template = { PK: key, SK: `SK#${key}`, subject: String(parsed.subject), pageTitle: String(parsed.pageTitle ?? ''), description: String(parsed.description ?? ''), pageContent: String(parsed.pageContent), status: 'active' };
    await Dynamo.write(template, table);
    return Responses._200({ messages: { success: 'Template created successfully' }, emailTemplate: template });
  } catch (error) {
    console.log('Template creation failed', error);
    return Responses._400({ messages: { unexpected: 'An unexpected error occurred' } });
  }
};
