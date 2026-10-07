const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, event } = require('./harness');
const bounce = (changes = {}) => ({ eventType: 'Bounce', mail: { messageId: 'ses-id', timestamp: '2026-10-07T10:00:00Z',
  destination: ['bounced@example.org', 'fine@example.org'], commonHeaders: { subject: 'Deadline' } },
  bounce: { timestamp: '2026-10-07T10:01:00Z', feedbackId: 'feedback', bounceType: 'Permanent', bounceSubType: 'General',
    bouncedRecipients: [{ emailAddress: ' BOUNCED@example.org ', diagnosticCode: 'No mailbox' }] }, ...changes });
const packet = (value, messageId = 'one') => ({ messageId, body: JSON.stringify(value) });
test('bounce event records only affected recipients, safely normalized, without sending or suppressing', async () => {
  const f = setup('comms/emailEvents');
  assert.equal((await f.invoke({ Records: [packet(bounce())] })).batchItemFailures.length, 0);
  assert.deepEqual(f.calls.map(c => c.name), ['DocumentClient.put']);
  const item = f.calls[0].args[0].Item;
  assert.equal(item.email, 'bounced@example.org'); assert.equal(item.subject, 'Deadline');
  assert.match(item.detail, /Permanent.*No mailbox/);
  assert.equal(f.calls[0].args[0].ConditionExpression, 'attribute_not_exists(PK)');
});
test('duplicate SES events have stable identities and conditional duplicates are acknowledged', async () => {
  const f = setup('comms/emailEvents', { handlers: { 'DocumentClient.put': () => { throw Object.assign(new Error('duplicate'), { code: 'ConditionalCheckFailedException' }); } } });
  assert.equal((await f.invoke({ Records: [packet(bounce()), packet(bounce(), 'two')] })).batchItemFailures.length, 0);
  assert.equal(f.calls[0].args[0].Item.SK, f.calls[1].args[0].Item.SK);
});
test('bad and failed event records retry independently without blocking the next event', async () => {
  const f = setup('comms/emailEvents');
  const r = await f.invoke({ Records: [{ messageId: 'bad', body: '{' }, packet(bounce())] });
  assert.equal(r.batchItemFailures[0].itemIdentifier, 'bad'); assert.equal(f.calls.length, 1);
  const failing = setup('comms/emailEvents', { fail: 'DocumentClient.put' });
  assert.equal((await failing.invoke({ Records: [packet(bounce())] })).batchItemFailures.length, 1);
});
for (const [kind, field, detail] of [
  ['Complaint', 'complaint', { complainedRecipients: [{ emailAddress: 'spam@example.org' }], complaintFeedbackType: 'abuse' }],
  ['Reject', 'reject', { reason: 'Bad content' }],
  ['Rendering Failure', 'failure', { errorMessage: 'Missing template field' }],
  ['DeliveryDelay', 'deliveryDelay', { delayType: 'MailboxFull', delayedRecipients: [{ emailAddress: 'full@example.org' }] }],
]) test(`records ${kind} details`, async () => {
  const f = setup('comms/emailEvents'); const e = bounce({ eventType: kind, [field]: detail });
  assert.equal((await f.invoke({ Records: [packet(e)] })).batchItemFailures.length, 0);
  assert.equal(f.calls[0].args[0].Item.kind, kind);
});
test('wrong-environment event is held and success events are ignored', async () => {
  const f = setup('comms/emailEvents', { env: { COMMS_DYNAMO_TABLE: 'cause-portal-v2-comms-dev' } });
  const e = bounce(); e.mail.tags = { 'ses:configuration-set': ['cause-portal-live'] };
  assert.equal((await f.invoke({ Records: [packet(e)] })).batchItemFailures.length, 1);
  assert.equal((await f.invoke({ Records: [packet({ eventType: 'Delivery' })] })).batchItemFailures.length, 0);
  assert.equal(f.calls.length, 0);
});
test('event list is paginated, attaches saved reviews and returns only the next cursor', async () => {
  const row = { PK: 'MAIL_ISSUE', SK: 'date#id', kind: 'Bounce', email: 'a@example.org', occurredAt: '2026-10-07' };
  let id;
  const f = setup('comms/issues', { handlers: {
    'DocumentClient.query': p => ({ Items: [row], LastEvaluatedKey: { PK: 'MAIL_ISSUE', SK: 'last' } }),
    'DocumentClient.batchGet': p => ({ Responses: { comms: [{ PK: 'MAIL_ISSUE_REVIEW', SK: id, status: 'resolved', version: 1, note: 'Checked' }] } }),
  } }); id = f.loadCommon('MailIssues').identity('events', row);
  const data = JSON.parse((await f.invoke(event())).body);
  assert.equal(data.issues[0].reviewStatus, 'resolved'); assert.equal(data.issues[0].note, 'Checked');
  assert.ok(data.nextCursor); assert.equal(f.calls[0].args[0].ScanIndexForward, false);
  const input = event(); input.queryStringParameters = { cursor: data.nextCursor };
  await f.invoke(input); assert.equal(f.calls[2].args[0].ExclusiveStartKey.SK, 'last');
});
test('cross-source cursor is rejected before any database access', async () => {
  const f = setup('comms/issues'); const input = event();
  input.queryStringParameters = { source: 'unsubscribes', cursor: Buffer.from(JSON.stringify({ source: 'events', key: { PK: 'MAIL_ISSUE', SK: 'x' } })).toString('base64') };
  assert.equal((await f.invoke(input)).statusCode, 400); assert.equal(f.calls.length, 0);
});
test('failure list surfaces stale claims but excludes recent, accepted and unrelated records', async () => {
  const f = setup('comms/issues', { handlers: {
    'DocumentClient.scan': () => ({ Items: [
      { PK: 'MAIL_DELIVERY#run', SK: 'failed@example.org', status: 'FAILED' },
      { PK: 'MAIL_DELIVERY#run', SK: 'stale@example.org', status: 'SENDING', startedAt: Date.now() - 400000 },
      { PK: 'MAIL_DELIVERY#run', SK: 'recent@example.org', status: 'SENDING', startedAt: Date.now() },
      { PK: 'MAIL_DELIVERY#run', SK: 'sent@example.org', status: 'SENT' }, { PK: 'EMAIL', SK: 'x', status: 'FAILED' },
    ] }),
  } }); const input = event(); input.queryStringParameters = { source: 'failures' };
  const data = JSON.parse((await f.invoke(input)).body); assert.equal(data.issues.length, 2);
  assert.equal(f.calls[0].args[0].Limit, 250);
});
test('unsubscribe list excludes new unverified signups and resubscribed addresses', async () => {
  const f = setup('comms/issues', { handlers: { 'DocumentClient.scan': () => ({ Items: [
    { PK: 'optedout@example.org', SK: 'hash', subscribed: false, dateUnsubscribed: '2026-10-07' },
    { PK: 'new@example.org', SK: 'hash', subscribed: false },
    { PK: 'back@example.org', SK: 'hash', subscribed: true, dateUnsubscribed: '2026-10-07' },
  ] }) } }); const input = event(); input.queryStringParameters = { source: 'unsubscribes' };
  const data = JSON.parse((await f.invoke(input)).body); assert.equal(data.issues.length, 1);
  assert.equal(data.issues[0].email, 'optedout@example.org'); assert.equal(f.calls[0].args[0].TableName, 'subscribers');
});
test('saving review only writes separate review and audit records with concurrency protection', async () => {
  const row = { PK: 'a@example.org', SK: 'hash', subscribed: false, dateUnsubscribed: '2026-10-07' };
  const f = setup('comms/reviewIssue', { handlers: { 'DocumentClient.get': () => ({ Item: row }) } });
  const id = f.loadCommon('MailIssues').identity('unsubscribes', row);
  const body = { source: 'unsubscribes', key: { PK: row.PK, SK: row.SK }, id, status: 'resolved', note: 'Reviewed', version: 0 };
  const response = await f.invoke(event(body)); assert.equal(response.statusCode, 200);
  const writes = f.calls.find(c => c.name === 'DocumentClient.transactWrite').args[0].TransactItems;
  assert.equal(writes[0].Put.Item.PK, 'MAIL_ISSUE_REVIEW'); assert.match(writes[1].Put.Item.PK, /^MAIL_ISSUE_HISTORY#/);
  assert.equal(writes[0].Put.ConditionExpression, 'attribute_not_exists(PK)');
  assert.equal(writes[0].Put.Item.actor, 'actor@example.org');
  assert.ok(writes.every(w => w.Put.TableName === 'comms'));
});
test('changed source and conflicting review saves cannot report success', async () => {
  const row = { PK: 'MAIL_DELIVERY#run', SK: 'a@example.org', status: 'FAILED', startedAt: 1 };
  const f = setup('comms/reviewIssue', { handlers: { 'DocumentClient.get': () => ({ Item: row }) }, fail: 'DocumentClient.transactWrite' });
  const id = f.loadCommon('MailIssues').identity('failures', row);
  const body = { source: 'failures', key: { PK: row.PK, SK: row.SK }, id, status: 'resolved', note: 'Checked', version: 2 };
  assert.equal((await f.invoke(event(body))).statusCode, 400);
  const write = f.calls[1].args[0].TransactItems[0].Put; assert.equal(write.ExpressionAttributeValues[':version'], 2);
  row.status = 'SENT'; assert.equal((await f.invoke(event(body))).statusCode, 400); assert.equal(f.calls.length, 3);
});
test('issue identity changes when the same address unsubscribes again or a failure changes', () => {
  const f = setup('comms/issues'); const { identity } = f.loadCommon('MailIssues');
  const row = { PK: 'a', SK: 'b', dateUnsubscribed: 'one' };
  assert.notEqual(identity('unsubscribes', row), identity('unsubscribes', { ...row, dateUnsubscribed: 'two' }));
});
test('email tracking selects isolated development and live streams', () => {
  for (const stage of ['dev', 'live']) {
    const f = setup('comms/issues', { env: { COMMS_DYNAMO_TABLE: `cause-portal-v2-comms-${stage}` } });
    assert.equal(f.loadCommon('MailTracking')().ConfigurationSetName, `cause-portal-${stage}`);
  }
});
