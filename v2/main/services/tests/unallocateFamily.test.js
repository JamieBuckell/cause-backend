const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,event,clone}=require('./harness');
const {donor,family}=require('./fixtures');
const owned={...family,allocatedTo:'donor',status:'allocated-unconfirmed'};
const linked=()=>({...clone(donor),familyDetails:{request:[{...clone(donor.familyDetails.request[0]),allocation:[{hamperId:'OLD-001',members:clone(family.members)}]}]}});
const lib=()=>setup('families/allocate').loadCommon('UnallocateFamily');
test('renumbered family removes its uniquely matching stale link, preserving pledge and other links',()=>{
 const d=linked();d.familyDetails.request[0].numberOfFamilies=10;
 d.familyDetails.request[0].allocation.push({hamperId:'OTHER',members:[{who:'Dad',age:40}]});
 const other={...owned,SK:'REF#other',GSI2PK:'other',GSI2SK:'SK#OTHER',members:[{who:'Dad',age:40}]};
 const p=lib().plan(d,[owned,other],{familyId:'family',hamperId:'outdated-client-reference'});
 assert.equal(p.family.SK,owned.SK);assert.equal(p.details.request[0].allocation.length,1);
 assert.equal(p.details.request[0].allocation[0].hamperId,'OTHER');assert.equal(p.details.request[0].numberOfFamilies,10);
 assert.equal(d.familyDetails.request[0].allocation.length,2);
});
test('normal unallocation works with no client pledge request ID',()=>{
 const d=linked();d.familyDetails.request[0].allocation[0].hamperId='ABJD-001';
 assert.equal(lib().plan(d,[owned],{hamperId:'ABJD-001'}).details.request[0].allocation.length,0);
});
test('a disconnected assignment without pledge links can be released',()=>{
 assert.equal(lib().plan(donor,[owned],{familyId:'family'}).details.request[0].allocation.length,0);
});
test('ambiguous member snapshots and links cannot remove a different family link',()=>{
 const d=linked(),other={...owned,SK:'REF#other',GSI2PK:'other',GSI2SK:'SK#OTHER'};
 assert.throws(()=>lib().plan(d,[owned,other],{familyId:'family'}),/ambiguous/);
 d.familyDetails.request[0].allocation.push(clone(d.familyDetails.request[0].allocation[0]));
 assert.throws(()=>lib().plan(d,[owned],{familyId:'family'}),/ambiguous/);
});
test('family belonging to another donor cannot be unallocated',()=>{
 assert.throws(()=>lib().plan(donor,[],{familyId:'family'}),/no longer allocated/);
});
function fixture(options={}) {
 return setup('families/allocate',{...options,handlers:{'DocumentClient.query':params=>({Items:params.ExpressionAttributeValues[':sk']==='EMAIL#'?[linked()]:[owned]}),...options.handlers}});
}
const removal=()=>({...event({campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',familyId:'family'}),path:'/families/allocate/remove'});
test('admin removal atomically updates family, donor and audit, without email',async()=>{
 const f=fixture();const r=await f.invoke(removal());assert.equal(r.statusCode,200);
 const tx=f.calls.find(c=>c.name==='DocumentClient.transactWrite').args[0].TransactItems;
 assert.equal(tx.length,3);assert.equal(tx[0].Update.ExpressionAttributeValues[':free'],'unallocated');
 assert.equal(tx[1].Update.ExpressionAttributeValues[':next'].request[0].allocation.length,0);
 assert.ok(tx[0].Update.ConditionExpression.includes('allocatedTo = :donor'));
 assert.ok(tx[1].Update.ConditionExpression.includes('familyDetails = :before'));
 assert.ok(f.calls.every(c=>c.name.startsWith('DocumentClient.')));
 assert.equal(JSON.parse(r.body).donor.familyDetails.request[0].allocation.length,0);
});
test('concurrent write conflict returns a refresh error without separate writes',async()=>{
 const f=fixture({handlers:{'DocumentClient.transactWrite':()=>{const e=Error('conflict');e.code='TransactionCanceledException';throw e;}}});
 const r=await f.invoke(removal());assert.equal(r.statusCode,400);assert.match(r.body,/Refresh and try again/);
 assert.equal(f.calls.filter(c=>c.name==='DocumentClient.transactWrite').length,1);
 assert.ok(!f.calls.some(c=>c.name==='Dynamo.write'));
});
test('non-admin removal is rejected before reading or writing',async()=>{
 const f=fixture(),e=removal();e.requestContext.authorizer.claims['cognito:groups']='Donor';
 assert.equal((await f.invoke(e)).statusCode,401);assert.equal(f.calls.length,0);
});
test('a reference collision with a different snapshot fails without changing links',()=>{
 const d=linked();d.familyDetails.request[0].allocation.push({hamperId:'ABJD-001',members:[{who:'Dad',age:50}]});
 assert.throws(()=>lib().plan(d,[owned],{familyId:'family'}),/conflicts/);
 assert.equal(d.familyDetails.request[0].allocation.length,2);
});
test('snapshot-based removal guards other family snapshots in the same transaction',async()=>{
 const other={...owned,SK:'REF#other',GSI2PK:'other',GSI2SK:'SK#OTHER',members:[{who:'Dad',age:50}]};
 const f=fixture({handlers:{'DocumentClient.query':params=>({Items:params.ExpressionAttributeValues[':sk']==='EMAIL#'?[linked()]:[owned,other]})}});
 assert.equal((await f.invoke(removal())).statusCode,200);
 const tx=f.calls.find(c=>c.name==='DocumentClient.transactWrite').args[0].TransactItems;
 assert.equal(tx.length,4);assert.equal(tx[3].ConditionCheck.Key.SK,'REF#other');
 assert.ok(tx[3].ConditionCheck.ConditionExpression.includes('members = :members'));
});
