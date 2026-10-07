// Both deployments use the same SES account: choose an explicit, isolated stream.
module.exports = () => {
  const stage = /-(dev|live)$/.exec(process.env.COMMS_DYNAMO_TABLE || "")?.[1];
  return stage ? { ConfigurationSetName: `cause-portal-${stage}` } : {};
};
