const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, event, clone } = require('./harness');
const { donor, family } = require('./fixtures');
const owned = { ...family, allocatedTo: 'donor', status: 'allocated-unconfirmed' };
const linked = { ...donor, familyDetails: { request: [{ ...donor.familyDetails.request[0], allocation: [{ hamperId: 'ABJD-001', members: family.members }] }] } };
const lib = () => setup('donors/updatePledge').loadCommon('DonorAllocations');
const jamieEvent = body => {
 const input = event(body); input.requestContext.authorizer.claims.email = 'email@jamiebuckell.co.uk';
 input.requestContext.authorizer.claims.email_verified = 'true'; return input;
};
const repairBody = { campaignId: 'TEST', donorId: 'donor', action: 'preview' };
test('pledge preferences can change while server allocations survive stale or forged client arrays', () => {
 const d=clone(linked), api=lib();
 const result=api.mergePledges(d,[owned],[{requestId:'request',numberOfFamilies:'2',familyDetail:['small','small'],additionalInfo:'New note',allocation:[{hamperId:'forged'}]}]);
 assert.equal(result[0].allocation[0].hamperId,'ABJD-001');assert.equal(result[0].numberOfFamilies,2);assert.equal(result[0].additionalInfo,'New note');
 assert.equal(d.familyDetails.request[0].numberOfFamilies,1);
});
for(const [name,requests] of [['delete',[]],['replace',[{requestId:'other',numberOfFamilies:1}]],['shrink',[{requestId:'request',numberOfFamilies:1}]]]) {
 test(`cannot ${name} a pledge with assigned families`,()=>{
  const d=clone(linked), second={...clone(owned),SK:'REF#second',GSI2SK:'SK#SECOND'};
  d.familyDetails.request[0].numberOfFamilies=2;d.familyDetails.request[0].allocation.push({hamperId:'SECOND',members:[]});
  assert.throws(()=>lib().mergePledges(d,[owned,second],requests),/Unallocate families/);
 });
}
test('orphaned family assignments block pledge editing until repaired',()=>{
 assert.throws(()=>lib().mergePledges(donor,[owned],[{requestId:'request',numberOfFamilies:2}]),/Reconnect/);
});
test('unallocated requests can be edited, replaced or deleted without accepting client allocation data',()=>{
 const result=lib().mergePledges(donor,[],[{requestId:'new',numberOfFamilies:2,allocation:[{hamperId:'invented'}]}]);
 assert.equal(result[0].allocation.length,0);assert.equal(lib().mergePledges(donor,[],[]).length,0);
});
test('duplicate request IDs, invalid counts and invalid preferences are rejected',()=>{
 for(const input of [[{requestId:'x',numberOfFamilies:2},{requestId:'x',numberOfFamilies:2}], [{requestId:'request',numberOfFamilies:-1}], [{requestId:'request',numberOfFamilies:1,familyDetail:'not-json'}]])
  assert.throws(()=>lib().mergePledges(donor,[],input));
});
test('repair reconnects only missing owned families and is idempotent',()=>{
 const api=lib(),plan=api.planRepair(donor,[owned]);
 assert.equal(plan.references[0],'ABJD-001');assert.equal(plan.requests[0].requestId,'request');
 assert.equal(donor.familyDetails.request[0].allocation.length,0);
 assert.equal(api.planRepair({...donor,familyDetails:{request:plan.requests}},[owned]).references.length,0);
});
test('repair refuses to guess between multiple eligible pledges',()=>{
 const d=clone(donor);d.familyDetails.request.push({...clone(d.familyDetails.request[0]),requestId:'second'});
 assert.throws(()=>lib().planRepair(d,[owned]),/will not guess/);
 const plan=lib().planRepair(d,[owned],'second');assert.equal(plan.targetRequestId,'second');assert.equal(plan.requests[0].allocation.length,0);
});
test('repair refuses stale links to other donors, duplicate links and insufficient capacity',()=>{
 assert.throws(()=>lib().planRepair(linked,[]),/conflicting/);
 const d=clone(linked);d.familyDetails.request[0].allocation.push(clone(d.familyDetails.request[0].allocation[0]));
 assert.throws(()=>lib().planRepair(d,[owned]),/conflicting/);
 const second={...clone(owned),SK:'REF#second',GSI2SK:'SK#SECOND'};
 assert.throws(()=>lib().planRepair(donor,[owned,second]),/enough free places/);
});
test('preview does not write or send mail and changes invalidate its fingerprint', async()=>{
 const f=setup('donors/reconnectAllocations',{rows:[clone(donor),clone(owned)]});
 const r=await f.invoke(jamieEvent(repairBody));assert.equal(r.statusCode,200);
 assert.ok(f.calls.every(c=>c.name==='DocumentClient.query'));
 const api=f.loadCommon('DonorAllocations');const p1=api.planRepair(donor,[owned]);
 const changed={...clone(owned),members:[]};assert.notEqual(api.planRepair(donor,[changed]).fingerprint,p1.fingerprint);
 const stale=await f.invoke(jamieEvent({...repairBody,action:'repair',fingerprint:'wrong'}));assert.equal(stale.statusCode,400);
 assert.ok(f.calls.every(c=>c.name==='DocumentClient.query'));
});
test('repair requires Jamie, administrator group and verified email on the backend', async()=>{
 for(const claims of [
  {email:'other@example.org','cognito:groups':'Admin',email_verified:'true'},
  {email:'email@jamiebuckell.co.uk','cognito:groups':'Donor',email_verified:'true'},
  {email:'email@jamiebuckell.co.uk','cognito:groups':'Admin',email_verified:'false'},
 ]) {
  const f=setup('donors/reconnectAllocations');const input=jamieEvent(repairBody);input.requestContext.authorizer.claims=claims;
  assert.equal((await f.invoke(input)).statusCode,401);assert.equal(f.calls.length,0);
 }
});
test('repair atomically checks family ownership and donor snapshot, writes audit, and never changes families or sends email', async()=>{
 const f=setup('donors/reconnectAllocations',{rows:[clone(donor),clone(owned)]});
 const preview=JSON.parse((await f.invoke(jamieEvent(repairBody))).body);
 assert.equal((await f.invoke(jamieEvent({...repairBody,...preview,action:'repair'}))).statusCode,200);
 const tx=f.calls.find(c=>c.name==='DocumentClient.transactWrite').args[0];
 assert.equal(tx.TransactItems.length,3);assert.equal(tx.TransactItems[0].Update.Key.SK,donor.SK);
 assert.match(tx.TransactItems[0].Update.ConditionExpression,/#details = :before/);
 assert.equal(tx.TransactItems[1].ConditionCheck.Key.SK,family.SK);
 assert.equal(tx.TransactItems[1].ConditionCheck.ExpressionAttributeValues[':donor'],'donor');
 assert.match(tx.TransactItems[2].Put.Item.PK,/^DONOR_CHANGE#/);
 assert.ok(!f.calls.some(c=>c.name.startsWith('Notifications')));
});
test('concurrent donor changes reject a pledge save before any notification', async()=>{
 const f=setup('donors/updatePledge',{rows:[clone(linked),clone(owned)],handlers:{'DocumentClient.transactWrite':()=>{throw Object.assign(new Error('Conflict'),{code:'TransactionCanceledException'})}}});
 const result=await f.invoke(event({campaignId:'TEST',donorId:'donor',campaignData:[{requestId:'request',numberOfFamilies:2}],sendEmail:true}));
 assert.equal(result.statusCode,400);assert.match(JSON.parse(result.body).messages.error,/changed while saving/);
 assert.ok(!f.calls.some(c=>c.name.startsWith('Notifications')));
});
test('notification failure after a saved pledge is reported as a saved record with a warning', async()=>{
 const f=setup('donors/updatePledge',{rows:[clone(donor)],fail:'Notifications.sendTransactionalEmail',functions:{getEmailTemplate:async()=>({subject:'Test'})}});
 const result=await f.invoke(event({campaignId:'TEST',donorId:'donor',campaignData:[{requestId:'request',numberOfFamilies:2}],sendEmail:true}));
 assert.equal(result.statusCode,200);const data=JSON.parse(result.body);assert.equal(data.donor.familyDetails.request[0].numberOfFamilies,2);assert.ok(data.notificationWarning);
});
