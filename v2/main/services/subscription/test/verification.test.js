const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const Hashing = require("../../common/Hashing");

const source = readFileSync(
  path.join(__dirname, "../endpoints/verification.js"), "utf8"
);

// Run the real handler with isolated database/email dependencies; no AWS calls.
function setup(email, { hasDonor = true } = {}) {
  const writes = [];
  const emails = [];
  const lookups = [];
  const subscriber = { PK: email, SK: "H#test-id", verified: false };
  const donor = {
    PK: "TEST", SK: `EMAIL#D#${email}`, GSI3PK: email,
    familyDetails: { request: [] }, donorDetails: {},
  };
  const response = statusCode => data => ({ statusCode, body: JSON.stringify(data) });
  const dependencies = {
    "../common/API_Responses": { _200: response(200), _400: response(400) },
    "../common/Hashing": Hashing,
    "../common/Dynamo": {
      get: async () => ({ PK: "TEST", campaignDetails: { registrationClosed: "2999-01-01" } }),
      query: async (query, table) => {
        lookups.push({ query, table });
        const values = query.ExpressionAttributeValues;
        if (table === "subscribers") return values[":pk"] === email ? [subscriber] : [];
        return hasDonor && values[":sk"] === donor.SK ? [donor] : [];
      },
      write: async (item, table) => { writes.push({ item, table }); },
    },
    "../common/Functions": {
      hasPermission: () => false,
      defaultCampaign: () => "TEST",
      getEmailTemplate: async () => ({}),
    },
    "../common/Notifications": {
      sendTransactionalEmail: async params => { emails.push(params); },
    },
    "moment-timezone": () => ({ tz: () => ({ format: () => "test-timestamp" }) }),
  };
  const context = {
    exports: {},
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    console: { log() {} },
    process: { env: {
      HASHING_SALT: "test-salt", HASHING_PREFIX: "H#",
      MAIN_DYNAMO_TABLE: "main", SUBSCRIBERS_TABLE: "subscribers",
    } },
  };
  vm.runInNewContext(source, context);
  return {
    writes, emails, lookups,
    invoke: (emailAddress, v = Hashing.hash("test-id", "test-salt").hashedpassword) =>
      context.exports.handler({
        pathParameters: { emailAddress }, queryStringParameters: { v, campaignId: "TEST" },
      }),
  };
}

for (const [label, email, input] of [
  ["encoded address", "donor@example.com", "donor%40example.com"],
  ["decoded address", "donor@example.com", "donor@example.com"],
  ["encoded plus alias", "donor+appeal@example.com", "donor%2Bappeal%40example.com"],
  ["decoded plus alias", "donor+appeal@example.com", "donor+appeal@example.com"],
  ["encoded literal percent sequence", "donor%40name@example.com", "donor%2540name%40example.com"],
  ["decoded literal percent sequence", "donor%40name@example.com", "donor%40name@example.com"],
  ["decoded literal percent", "donor%name@example.com", "donor%name@example.com"],
]) {
  test(`verifies subscriber and donor with ${label}`, async () => {
    const fixture = setup(email);
    const result = await fixture.invoke(input);
    assert.equal(result.statusCode, 200);
    assert.equal(fixture.writes.length, 2);
    assert.equal(fixture.writes[0].item.verified, true);
    assert.equal(fixture.writes[1].item.emailVerification.verified, true);
    assert.equal(fixture.emails.length, 1);
    assert.equal(fixture.emails[0].ToAddresses[0], email);
  });
}

test("rejects a malformed encoded address without database queries or writes", async () => {
  const fixture = setup("donor@example.com");
  const result = await fixture.invoke("donor%ZZ%40example.com");
  assert.equal(result.statusCode, 400);
  assert.equal(fixture.lookups.length, 0);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.emails.length, 0);
});

test("decoding does not bypass subscriber token validation", async () => {
  const fixture = setup("donor@example.com", { hasDonor: false });
  const result = await fixture.invoke("donor%40example.com", "invalid-token");
  assert.equal(result.statusCode, 400);
  assert.equal(fixture.lookups[0].query.ExpressionAttributeValues[":pk"], "donor@example.com");
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.emails.length, 0);
});
