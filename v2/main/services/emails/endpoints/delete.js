const Responses = require('../common/API_Responses');
const Dynamo = require('../common/Dynamo');
const Functions = require('../common/Functions');

exports.handler = async event => {
  try {
    if (!Functions.hasPermission(event, 'Admin')) return Responses._401({ messages: { unauthorized: 'Admin access is required' } });
    const key = event.pathParameters?.key;
    if (!key) return Responses._400({ messages: { key: 'Template key is required' } });
    const table = process.env.EMAIL_TEMPLATES_TABLE;
    const templates = await Dynamo.query({
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: { '#pk': 'PK' }, ExpressionAttributeValues: { ':pk': key },
    }, table);
    if (!templates.length) return Responses._400({ messages: { error: 'Template not found' } });
    for (const template of templates) await Dynamo.write({ ...template, status: 'deleted' }, table);
    return Responses._200({ messages: { success: 'Template deleted successfully' } });
  } catch (error) {
    console.log('Template deletion failed', error);
    return Responses._400({ messages: { unexpected: 'An unexpected error occurred' } });
  }
};
