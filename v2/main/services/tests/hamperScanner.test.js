const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, event } = require('./harness');
const campaign = { PK: 'CURRENT', type: 'campaign', status: 'active', campaignName: 'Current campaign', campaignDetails: { campaignStart: '2000-01-01T00:00:00Z', campaignEnd: '2100-01-01T00:00:00Z', registrationClosed: '2001-01-01T00:00:00Z' } };
const family = { PK: 'CURRENT', SK: 'REF#family', GSI2SK: 'SK#HC04HL-012', members: [], totalUnit: 1 };
function fixture(endpoint, campaigns = [campaign], families = [family], extra = {}) {
  return setup(`hampers/${endpoint}`, { handlers: {
    'Dynamo.query': params => params.IndexName === 'GSI2' ? campaigns : params.ExpressionAttributeValues[':sk'] === 'REF#' ? JSON.parse(JSON.stringify(families)) : [],
  }, ...extra });
}
for (const endpoint of ['check', 'receive']) {
  test(`${endpoint} resolves current campaign despite stale selection and normalises ID`, async () => {
    const f = fixture(endpoint);
    const result = await f.invoke(event({ campaignId: 'OLD', hamperId: ' hc04hl012\n', noBags: 2 }));
    const data = JSON.parse(result.body);
    assert.equal(data.success, true, result.body);
    assert.equal(data.campaignId, 'CURRENT');
    assert.equal(data.hamperId, 'HC04HL-012');
    const lookup = f.calls.find(c => c.name === 'Dynamo.query' && !c.args[0].IndexName);
    assert.equal(lookup.args[0].ExpressionAttributeValues[':pk'], 'CURRENT');
    assert.equal(lookup.args[0].ConsistentRead, true);
    if (endpoint === 'receive') assert.equal(f.calls.find(c => c.name === 'Dynamo.write').args[0].bagsReceived, 2);
  });
  for (const campaigns of [[], [campaign, { ...campaign, PK: 'OTHER' }]]) {
    test(`${endpoint} refuses ${campaigns.length} current campaigns without writing`, async () => {
      const f = fixture(endpoint, campaigns);
      const result = await f.invoke(event({ hamperId: 'HC04HL-012', noBags: 2 }));
      assert.equal(result.statusCode, 400);
      assert.equal(f.calls.filter(c => c.name === 'Dynamo.write').length, 0);
      assert.match(result.body, /campaign/i);
    });
  }
  test(`${endpoint} rejects a campaign rollover before looking up or writing a hamper`, async () => {
    const f = fixture(endpoint);
    const result = await f.invoke(event({ expectedCampaignId: 'OLD', hamperId: 'HC04HL-012', noBags: 2 }));
    assert.match(result.body, /campaign has changed/);
    assert.equal(f.calls.length, 1);
  });
  test(`${endpoint} reports genuine missing hampers and logs their resolved campaign`, async () => {
    const f = fixture(endpoint, [campaign], []);
    const result = await f.invoke(event({ hamperId: 'hc04hl012', noBags: 2 }));
    assert.match(result.body, /Hamper ID not found/);
    assert.ok(JSON.stringify(f.logs).includes('CURRENT'));
    assert.equal(f.calls.filter(c => c.name === 'Dynamo.write').length, 0);
  });
}
test('campaign resolver uses campaign dates, excludes deleted and invalid ranges, and includes boundaries', async () => {
  const f = fixture('currentCampaign', [campaign, { ...campaign, status: 'deleted' }, { ...campaign, campaignDetails: { campaignStart: 'invalid' } }]);
  const api = f.loadCommon('HamperScanner');
  assert.equal((await api.currentCampaign('main', Date.parse(campaign.campaignDetails.campaignStart))).campaignId, 'CURRENT');
  assert.equal((await api.currentCampaign('main', Date.parse(campaign.campaignDetails.campaignEnd))).campaignId, 'CURRENT');
  await assert.rejects(api.currentCampaign('main', Date.parse('2101-01-01')), /No campaign/);
  const result = await f.invoke();
  assert.equal(JSON.parse(result.body).campaignName, 'Current campaign');
});
test('receipt never reports success when persistence fails', async () => {
  const f = fixture('receive', [campaign], [family], { fail: 'Dynamo.write' });
  const result = await f.invoke(event({ hamperId: 'HC04HL-012', noBags: 2 }));
  assert.equal(result.statusCode, 400);
  assert.equal(JSON.parse(result.body).success, false);
});
