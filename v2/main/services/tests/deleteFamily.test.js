const {test}=require('node:test');
const assert=require('node:assert/strict');
const {setup,event,clone}=require('./harness');
const {donor,family}=require('./fixtures');
const owned={...family,allocatedTo:'donor',status:'allocated-confirmed'};
function fixture({target=owned,links=[{hamperId:'ABJD-001',members:family.members}],conflict=false}={}) {
 const d=clone(donor);d.familyDetails.request[0].numberOfFamilies=34;d.familyDetails.request[0].allocation=links;
 return setup('families/delete',{rows:[target],handlers:{
  'DocumentClient.query':p=>({Items:p.ExpressionAttributeValues[':sk']==='EMAIL#'?[d]:[target]}),
  'DocumentClient.transactWrite':()=>{if(conflict){const e=Error('conflict');e.code='TransactionCanceledException';throw e;}return {};}
 }});
}
const invoke=f=>f.invoke(event({},{familyId:'family'}));
const tx=f=>f.calls.find(c=>c.name==='DocumentClient.transactWrite').args[0].TransactItems;
test('assigned deletion removes only its pledge link atomically without changing pledge count or sending email',async()=>{
 const other={hamperId:'OTHER',members:[{who:'Adult',age:60}]};
 const f=fixture({links:[{hamperId:'ABJD-001',members:family.members},other]});
 assert.equal((await invoke(f)).statusCode,200);const ops=tx(f);assert.equal(ops.length,3);
 assert.equal(ops[0].Update.ExpressionAttributeValues[':deleted'],'deleted');
 assert.ok(ops[0].Update.ConditionExpression.includes('#f5 = :f5'));
 const r=ops[1].Update.ExpressionAttributeValues[':next'].request[0];assert.equal(r.numberOfFamilies,34);
 assert.equal(JSON.stringify(r.allocation),JSON.stringify([other]));
 assert.ok(ops[1].Update.ConditionExpression.includes('familyDetails = :before'));
 assert.equal(ops[2].Put.Item.type,'family-deletion');
 assert.ok(!f.calls.some(c=>c.name.startsWith('Notifications.')||c.name==='Dynamo.write'));
});
test('unallocated deletion guards concurrent allocation and does not update a donor',async()=>{
 const f=fixture({target:family});assert.equal((await invoke(f)).statusCode,200);assert.equal(tx(f).length,2);
 assert.equal(tx(f)[0].Update.ExpressionAttributeValues[':f5'],'unallocated');
 assert.ok(!f.calls.some(c=>c.name==='DocumentClient.query'));
});
test('renumbered link is removed using a unique member snapshot',async()=>{
 const f=fixture({links:[{hamperId:'OLD',members:family.members}]});assert.equal((await invoke(f)).statusCode,200);
 assert.equal(tx(f)[1].Update.ExpressionAttributeValues[':next'].request[0].allocation.length,0);
});
test('duplicate links prevent deletion before writes',async()=>{
 const link={hamperId:'ABJD-001',members:family.members},f=fixture({links:[link,link]});
 assert.equal((await invoke(f)).statusCode,400);assert.ok(!f.calls.some(c=>c.name==='DocumentClient.transactWrite'||c.name==='Dynamo.write'));
});
test('concurrent change returns refresh error without fallback writes',async()=>{
 const f=fixture({conflict:true});const r=await invoke(f);assert.equal(r.statusCode,400);assert.match(r.body,/Refresh and try again/);
 assert.ok(!f.calls.some(c=>c.name==='Dynamo.write'));
});
test('already deleted family is a no-op',async()=>{
 const f=fixture({target:{...owned,status:'deleted'}});assert.equal((await invoke(f)).statusCode,200);
 assert.ok(!f.calls.some(c=>c.name==='DocumentClient.transactWrite'));
});
