const { test } = require('node:test');
const assert = require('node:assert/strict');
const { event, clone } = require('./harness');
const { campaign,org,nom,family,donor,subscriber,fixture,token,decoded,writes,batches } = require('./fixtures');

for (const verified of [false,true]) test(`invalid verification token cannot verify a donor (subscriber verified=${verified})`, async()=>{
  const f=fixture('subscription/verification',{handlers:{'Dynamo.query':async(p,t)=>t==='subscribers'?[{...subscriber,verified}]:[clone(donor)],'Dynamo.get':async()=>clone(campaign)}});
  const input=event({}, {emailAddress:'donor@example.org'},'');input.queryStringParameters={campaignId:'TEST',v:'invalid'};
  assert.equal((await f.invoke(input)).statusCode,400);assert.equal(writes(f).length,0);assert.ok(!f.calls.some(c=>c.name.startsWith('Notifications')));
});
test('standalone subscription verification never looks up or modifies a campaign',async()=>{
  const f=fixture('subscription/verification',{rows:[{...subscriber,verified:false,pendingSubscription:true}]});
  const input=event({}, {emailAddress:'donor@example.org'},'');input.queryStringParameters={v:token('token')};
  assert.equal((await f.invoke(input)).statusCode,200);assert.ok(f.calls.every(c=>c.args[1]==='subscribers'));
});
test('public signup does not silently reactivate an unsubscribed address',async()=>{
  const f=fixture('subscription/subscribe',{rows:[{...subscriber,subscribed:false}]});
  assert.equal((await f.invoke(event({firstname:'Jane',lastname:'Doe',email:'donor@example.org'},{},''))).statusCode,200);
  assert.equal(writes(f)[0].args[0].subscribed,false);assert.equal(writes(f)[0].args[0].pendingSubscription,true);
});
for(const role of ['Nominator','TeamLead']) for(const ep of ['families/update','families/delete','families/create']) test(`${ep} rejects ${role} managing another organisation`,async()=>{
  const actor={...clone(nom),GSI2PK:'actor',GSI3PK:'other-org',type:role==='TeamLead'?'team-lead':'nominator'};
  const target={...clone(nom),SK:'EMAIL#target@example.org',nominatorDetails:{...nom.nominatorDetails,email:'target@example.org'}};
  const body={campaign:'TEST',nominator:'nom',nominations:[{familyId:'family',hamperId:'ABJD-001',members:family.members}]};
  const f=fixture(ep,{handlers:{'Dynamo.scan':async()=>ep.endsWith('/delete')?[clone(family)]:[clone(campaign),clone(org),actor,target,clone(family)],'Dynamo.query':async()=>[actor]}});
  const r=await f.invoke(event(body,{familyId:'family'},role));
  assert.ok([400,401].includes(r.statusCode));assert.equal(writes(f).length,0);
});
test('nominator cannot edit another nominator’s family in the same organisation',async()=>{
  const f=fixture('families/update',{rows:[campaign,org,nom,{...family,GSI3SK:'someone-else'}]});
  const r=await f.invoke(event({campaign:'TEST',nominations:[{familyId:'family',members:family.members}]},{},'Nominator'));
  assert.equal(r.statusCode,401);assert.equal(writes(f).length,0);
});
test('team lead cannot delete an admin using the admin URL variant',async()=>{
  const f=fixture('users/delete');assert.equal((await f.invoke(event({}, {organisationId:'org',emailAddress:'other@example.org',userType:'admin'},'TeamLead'))).statusCode,401);assert.equal(f.calls.length,0);
});
test('nominator self update cannot overwrite account identifiers',async()=>{
  const f=fixture('nominators/update',{rows:[nom]});
  const r=await f.invoke(event({requestId:'nom',campaignId:'TEST',cognitoId:'attacker',reference:'ATTACK',originalEmail:'victim@example.org',firstName:'Jane'},{},'Nominator'));
  assert.equal(r.statusCode,200);assert.equal(writes(f)[0].args[0].nominatorDetails.cognitoId,'id');assert.equal(writes(f)[0].args[0].nominatorDetails.reference,'JD');assert.ok(!f.calls.some(c=>c.name.startsWith('Cognito')));
});
test('invalid donor request cannot partially allocate a family',async()=>{
  const f=fixture('families/allocate',{handlers:{'Dynamo.scan':async()=>[clone(family)],'Dynamo.query':async()=>[clone(donor)]}});
  assert.equal((await f.invoke(event({campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',requestId:'missing'}))).statusCode,400);assert.equal(writes(f).length,0);
});
test('allocation cannot select a donor from another campaign',async()=>{
  const f=fixture('families/allocate',{handlers:{'Dynamo.scan':async()=>[clone(family)],'Dynamo.query':async()=>[{...clone(donor),PK:'OTHER'}]}});
  assert.equal((await f.invoke(event({campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',requestId:'request'}))).statusCode,400);assert.equal(writes(f).length,0);
});
test('removing a missing allocation does not remove the final unrelated hamper',async()=>{
  const d=clone(donor);d.familyDetails.request[0].allocation=[{hamperId:'OTHER'}];
  const f=fixture('families/allocate',{handlers:{'Dynamo.scan':async()=>[{...clone(family),allocatedTo:'donor'}],'Dynamo.query':async()=>[d]}});
  const input=event({campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',requestId:'request'});input.path='/families/allocate/remove';
  assert.equal((await f.invoke(input)).statusCode,200);assert.equal(writes(f)[1].args[0].familyDetails.request[0].allocation[0].hamperId,'OTHER');
});
test('failed family unallocation prevents donor deletion',async()=>{
  const f=fixture('donors/delete',{fail:'Dynamo.batchWrite',handlers:{'Dynamo.scan':async()=>[clone(donor)],'Dynamo.query':async()=>[{...clone(family),allocatedTo:'donor'}]}});
  assert.equal((await f.invoke(event({campaign:'TEST',donorId:'donor'}))).statusCode,400);assert.equal(writes(f).length,0);assert.ok(!f.calls.some(c=>c.name==='Dynamo.delete'));
});
test('donor email collision is rejected before any writes',async()=>{
  const f=fixture('donors/emailUpdate',{rows:[donor,{...donor,GSI2PK:'other',GSI3PK:'new@example.org'}]});
  assert.equal((await f.invoke(event({campaign:'TEST',donorId:'donor',previousEmail:'donor@example.org',updatedEmail:'new@example.org'}))).statusCode,400);assert.equal(writes(f).length,0);
});
test('unchanged donor email cannot mark the original record deleted',async()=>{
  const f=fixture('donors/emailUpdate',{rows:[donor]});
  assert.equal((await f.invoke(event({campaign:'TEST',donorId:'donor',previousEmail:'donor@example.org',updatedEmail:'donor@example.org'}))).statusCode,200);assert.equal(writes(f).length,0);
});
test('report buckets preserve 08:00, 09:10 and round 09:55 to 10:00 without duplicate dates',async()=>{
  const rows=['08:00','09:10','09:55'].map(t=>({...family,status:'allocated-confirmed',receiveStatus:'hamper-received',receivedDate:`2026-12-01 ${t}:00`}));
  for(const endpoint of ['reports/dropOffs','reports/allDropOffs']){
    const f=fixture(endpoint,{rows});const r=await f.invoke(event({}, {campaignId:'TEST',date:'20261201'}));assert.equal(r.statusCode,200);
    const data=decoded(r);const series=endpoint.endsWith('/dropOffs')?data.timeData:data.allDropOffsData[0];
    if(data.allDropOffsData)assert.equal(data.allDropOffsData.length,1);
    assert.equal(series.data.reduce((sum,d)=>sum+d.y,0),3);
    assert.deepEqual(series.data.filter(d=>d.y).map(d=>new Date(d.x).toISOString().slice(11,16)),['08:00','09:15','10:00']);
  }
});
test('family reference allocation continues past 100 instead of reusing an occupied ID',async()=>{
  const rows=[campaign,org,nom,...Array.from({length:101},(_,i)=>({...family,SK:`REF#${i}`,GSI2SK:`SK#ABJD-${String(i+1).padStart(3,'0')}`}))];
  const f=fixture('families/create',{rows});
  assert.equal((await f.invoke(event({campaign:'TEST',nominator:'nom',nominations:[{hamperId:'ABJD-001',members:family.members}]}))).statusCode,200);
  assert.equal(writes(f)[0].args[0].GSI2SK,'SK#ABJD-102');
});
test('user listing handles pagination and users without a name attribute',async()=>{
  const f=fixture('users/list',{handlers:{'CognitoIdentityServiceProvider.listUsersInGroup':async p=>p.NextToken?{Users:[{Attributes:[{Name:'email',Value:'second@example.org'}]}]}:{Users:[{Attributes:[{Name:'email',Value:'first@example.org'}]}],NextToken:'next'}}});
  const r=await f.invoke(event({}, {userType:'admin'}));assert.equal(r.statusCode,200);assert.equal(Object.values(decoded(r)).length,2);
});
for(const userType of ['invalid',''])test(`invalid user type ${JSON.stringify(userType)} never creates an admin`,async()=>{
  const f=fixture('users/create');assert.equal((await f.invoke(event({firstname:'Jane',lastname:'Doe',email:'person@example.org'},{userType}))).statusCode,400);assert.equal(f.calls.length,0);
});
for(const bags of [-1,0,1.5,'bad'])test(`receive rejects invalid bag count ${bags}`,async()=>{
  const f=fixture('hampers/receive',{rows:[family]});assert.equal((await f.invoke(event({campaignId:'TEST',hamperId:'ABJD-001',noBags:bags},{},''))).statusCode,400);assert.equal(f.calls.length,0);
});
test('CSV download uses a direct unencoded response and excludes deleted families',async()=>{
  const f=fixture('donors/downloadFile',{rows:[donor,{...family,allocatedTo:'donor'},{...family,GSI2SK:'SK#DELETED',allocatedTo:'donor',status:'deleted'}]});
  const r=await f.invoke(event({campaign:'TEST',donorId:'donor',type:'csv'}));assert.equal(r.statusCode,200);assert.equal(r.isBase64Encoded,false);assert.ok(r.body.includes('ABJD-001'));assert.ok(!r.body.includes('DELETED'));
});
