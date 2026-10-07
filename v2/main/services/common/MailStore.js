const AWS = require("aws-sdk");
const client = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_ACCOUNT_REGION || "eu-west-2" });
const table = () => process.env.COMMS_DYNAMO_TABLE;

module.exports = {
  async get(key) {
    return (await client.get({ TableName: table(), Key: key, ConsistentRead: true }).promise()).Item;
  },
  async create(item) {
    try {
      await client.put({ TableName: table(), Item: item, ConditionExpression: "attribute_not_exists(PK)" }).promise();
      return true;
    } catch (error) {
      if (error.code === "ConditionalCheckFailedException") return false;
      throw error;
    }
  },
  async update(key, values, expected = {}) {
    const names = {}, attributes = {}, sets = [], conditions = [];
    Object.entries(values).forEach(([name, value], i) => {
      names[`#v${i}`] = name; attributes[`:v${i}`] = value; sets.push(`#v${i} = :v${i}`);
    });
    Object.entries(expected).forEach(([name, value], i) => {
      names[`#e${i}`] = name; attributes[`:e${i}`] = value; conditions.push(`#e${i} = :e${i}`);
    });
    return client.update({ TableName: table(), Key: key, UpdateExpression: `SET ${sets.join(", ")}`,
      ...(conditions.length ? { ConditionExpression: conditions.join(" AND ") } : {}),
      ExpressionAttributeNames: names, ExpressionAttributeValues: attributes }).promise();
  },
  async recordSent(key, owner, recipientRecord, messageId) {
    await client.transactWrite({ TransactItems: [
      { Update: { TableName: table(), Key: key,
        UpdateExpression: "SET #status = :sent, sesMessageId = :id, dateSent = :date",
        ConditionExpression: "#status = :sending AND #owner = :owner",
        ExpressionAttributeNames: { "#status": "status", "#owner": "owner" },
        ExpressionAttributeValues: { ":sent": "SENT", ":sending": "SENDING", ":id": messageId,
          ":date": recipientRecord.dateSent, ":owner": owner } } },
      { Put: { TableName: table(), Item: recipientRecord } },
    ] }).promise();
  },
};
