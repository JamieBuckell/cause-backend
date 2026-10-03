const AWS = require("aws-sdk");
AWS.config.update({
  maxRetries: 15,
  retryDelayOptions: { base: 1000 },
});

const documentClient = new AWS.DynamoDB.DocumentClient();

const Dynamo = {
  async reserveNominatorReference({ campaignId, organisationId, reference, owner }, TableName) {
    try {
      await documentClient.put({
        TableName,
        Item: {
          PK: `NOMINATOR_REFERENCE#${JSON.stringify([campaignId, organisationId])}`,
          SK: reference,
          type: "nominator-reference-reservation",
          owner,
        },
        ConditionExpression: "attribute_not_exists(PK) OR #owner = :owner",
        ExpressionAttributeNames: { "#owner": "owner" },
        ExpressionAttributeValues: { ":owner": owner },
      }).promise();
      return true;
    } catch (error) {
      if (error.code === "ConditionalCheckFailedException") return false;
      throw error;
    }
  },
  async query(params, TableName) {
    const request = { ...params, TableName };
    const items = [];
    let count = 0;
    do {
      const data = await documentClient.query(request).promise();
      if (!data || (request.Select !== "COUNT" && !Array.isArray(data.Items))) {
        throw new Error("Invalid DynamoDB query response");
      }
      items.push(...(data.Items ?? []));
      count += data.Count ?? 0;
      request.ExclusiveStartKey = data.LastEvaluatedKey;
    } while (request.ExclusiveStartKey && Object.keys(request.ExclusiveStartKey).length);
    return request.Select === "COUNT" ? count : items;
  },
  async get(requestKey, TableName) {
    const params = {
      TableName,
      Key: requestKey,
    };

    const data = await documentClient.get(params).promise();

    if (!data || !data.Item) {
      console.log(data);
      throw Error(
        `There was an error fetching the data with the params ${JSON.stringify(
          params
        )} from ${TableName}`
      );
    }

    return data.Item;
  },
  async scan(params) {
    if (!params?.TableName) {
      throw Error("Table name must be provided");
    }

    const request = { ...params };
    const data = [];
    let count = 0;
    do {
      const page = await documentClient.scan(request).promise();
      if (!page || (request.Select !== "COUNT" && !Array.isArray(page.Items))) {
        throw new Error("Invalid DynamoDB scan response");
      }
      data.push(...(page.Items ?? []));
      count += page.Count ?? 0;
      request.ExclusiveStartKey = page.LastEvaluatedKey;
    } while (request.ExclusiveStartKey && Object.keys(request.ExclusiveStartKey).length);
    return request.Select === "COUNT" ? count : data;
  },
  async write(data, TableName) {
    const params = {
      TableName,
      Item: data,
    };

    const res = await documentClient.put(params).promise();

    if (!res) {
      throw Error(`There was an error inserting in table ${TableName}`);
    }

    return data;
  },
  async batchWrite(batchData, TableName) {
    if (!TableName || !Array.isArray(batchData) || batchData.length > 25) {
      throw new Error("A table and at most 25 batch requests are required");
    }
    let pending = batchData;
    for (let attempt = 0; pending.length; attempt++) {
      const res = await documentClient.batchWrite({ RequestItems: { [TableName]: pending } }).promise();
      if (!res) throw new Error(`Invalid batch write response from ${TableName}`);
      pending = res.UnprocessedItems?.[TableName] ?? [];
      if (pending.length) {
        if (attempt >= 7) throw new Error(`Unprocessed batch writes remain in ${TableName}`);
        await new Promise(resolve => setTimeout(resolve, Math.min(100 * 2 ** attempt, 2000)));
      }
    }
    return batchData;
  },
  async delete(requestKey, TableName) {
    const params = {
      TableName,
      Key: requestKey,
    };

    const res = await documentClient.delete(params).promise();

    if (!res) {
      throw Error(
        `There was an error deleteing item ${requestKey} in table ${TableName}`
      );
    }

    return res;
  },
};
module.exports = Dynamo;
