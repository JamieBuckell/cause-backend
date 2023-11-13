const AWS = require("aws-sdk");
AWS.config.update({
  maxRetries: 15,
  retryDelayOptions: { base: 1000 },
});

const documentClient = new AWS.DynamoDB.DocumentClient();

const Dynamo = {
  async query(params, TableName) {
    params.TableName = TableName;

    const data = await documentClient.query(params).promise();

    if (!data || !data.Items) {
      throw Error(
        `There was an error fetching the data for query ${JSON.stringify(
          params
        )} from ${TableName} ${JSON.stringify(data)}`
      );
    }

    return data.Items;
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

    const data = [];
    let items = {};
    do {
      items = await documentClient.scan(params).promise();
      items.Items.forEach((item) => data.push(item));
      params.ExclusiveStartKey = items.LastEvaluatedKey;
    } while (typeof items.LastEvaluatedKey !== "undefined");

    if (params["Select"] && params["Select"] === "COUNT" && data.Count) {
      return data.Count;
    }

    if (!data) {
      throw Error(
        `There was an error fetching all data from ${params.TableName}`
      );
    }

    return data;
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
    const params = {
      RequestItems: {
        [TableName]: batchData,
      },
    };

    const res = await documentClient.batchWrite(params).promise();

    if (!res) {
      throw Error(`There was an error inserting in table ${TableName}`);
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
