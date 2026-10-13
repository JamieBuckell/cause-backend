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
function setup(email, { hasDonor = true, groups = "", closed = false, alreadyVerified = false } = {}) {
  const writes = [];
  const emails = [];
  const lookups = [];
  const subscriber = { PK: email, SK: "H#test-id", verified: false };
  const donor = {
    PK: "TEST", SK: `EMAIL#D#${email}`, GSI3PK: email,
    familyDetails: { request: [] }, donorDetails: {}, emailVerification: { verified: alreadyVerified },
  };
  const response = statusCode => data => ({ statusCode, body: JSON.stringify(data) });
  const dependencies = {
    "../common/API_Responses": { _200: response(200), _400: response(400), _401: response(401) },
    "../common/Hashing": Hashing,
    "../common/Dynamo": {
      get: async () => ({ PK: "TEST", campaignDetails: { registrationClosed: closed ? "2000-01-01" : "2999-01-01" } }),
      query: async (query, table) => {
        lookups.push({ query, table });
        const values = query.ExpressionAttributeValues;
        if (table === "subscribers") return values[":pk"] === email ? [subscriber] : [];
        return hasDonor && values[":sk"] === donor.SK ? [donor] : [];
      },
      write: async (item, table) => { writes.push({ item, table }); },
    },
    "../common/Functions": {
      hasPermission: (event, group) => (event.requestContext?.authorizer?.claims?.["cognito:groups"] || "").split(",").includes(group),
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
    manual: (campaignId = "TEST") => context.exports.manualHandler({
      pathParameters: { emailAddress: email }, queryStringParameters: { campaignId },
      requestContext: { authorizer: { claims: { "cognito:groups": groups, email: "admin@example.com" } } },
    }),
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

for (const groups of ["", "Donor", "Nominator"]) test(`manual verification rejects non-admin group '${groups}' before reading or writing`, async () => {
  const f = setup("donor@example.com", { groups });
  assert.equal((await f.manual()).statusCode, 401);
  assert.equal(f.lookups.length, 0);
  assert.equal(f.writes.length, 0);
  assert.equal(f.emails.length, 0);
});
for (const closed of [false, true]) test(`admin verifies the exact donor without a token (closed campaign=${closed})`, async () => {
  const f = setup("donor@example.com", { groups: "Admin,Other", closed });
  assert.equal((await f.manual()).statusCode, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].table, "main");
  assert.equal(f.writes[0].item.emailVerification.verifiedBy, "admin@example.com");
  assert.equal(f.writes[0].item.emailVerification.method, "admin");
  assert.equal(f.emails.length, 1);
});
test("admin verification requires a campaign and never reports success for a missing donor", async () => {
  const f = setup("donor@example.com", { groups: "Admin", hasDonor: false });
  assert.equal((await f.manual("")).statusCode, 400);
  assert.equal(f.lookups.length, 0);
  assert.equal((await f.manual()).statusCode, 400);
  assert.equal(f.writes.length, 0);
  assert.equal(f.emails.length, 0);
});
test("repeated admin verification does not write or send another email", async () => {
  const f = setup("donor@example.com", { groups: "Admin", alreadyVerified: true });
  assert.equal((await f.manual()).statusCode, 200);
  assert.equal(f.writes.length, 0);
  assert.equal(f.emails.length, 0);
});
test("public verification still rejects an empty token before reading", async () => {
  const f = setup("donor@example.com");
  assert.equal((await f.invoke("donor@example.com", "")).statusCode, 400);
  assert.equal(f.lookups.length, 0);
});
test("manual POST has Cognito authorization while public GET remains public", () => {
  const config = readFileSync(path.join(__dirname, "../serverless.yml"), "utf8");
  const manual = config.split("  manualVerification:\n")[1].split("  verification:\n")[0];
  assert.match(manual, /method: post/);
  assert.match(manual, /type: COGNITO_USER_POOLS/);
  assert.match(manual, /handler: endpoints\/verification.manualHandler/);
  const publicRoute = config.split("  verification:\n")[1].split("  list:\n")[0];
  assert.match(publicRoute, /method: get/);
  assert.doesNotMatch(publicRoute, /authorizer:/);
});
