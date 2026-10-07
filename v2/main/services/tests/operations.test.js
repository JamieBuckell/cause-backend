const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, event, clone } = require('./harness');
const Hashing = require('../common/Hashing');
const token = data => Hashing.hash(data, 'test-salt').hashedpassword;
const campaign = { PK: 'TEST', SK: 'A', type: 'campaign', campaignName: 'Test', status: 'active', campaignDetails: { registrationOpen: '2000-01-01', registrationClosed: '2999-01-01', nominationsClosed: '2999-01-01' } };
const org = { PK: 'TEST', SK: 'AB', GSI2PK: 'org', type: 'organisation', hash: { data: 'org-data', salt: 'org-salt' }, organisation: { name: 'School' } };
const nom = { PK: 'TEST', SK: 'EMAIL#actor@example.org', GSI2PK: 'nom', GSI3PK: 'org', type: 'nominator', nominatorDetails: { firstName: 'Jane', lastName: 'Doe', email: 'actor@example.org', reference: 'JD', telephone: '01234567890', cognitoId: 'id' }, emailVerification: {} };
const family = { PK: 'TEST', SK: 'REF#family', GSI2PK: 'family', GSI2SK: 'SK#ABJD-001', GSI3PK: 'org', GSI3SK: 'nom', type: 'family', status: 'unallocated', allocatedTo: 'unallocated', members: [{ who: 'Adult', age: 30, ageType: 'years' }], totalUnit: 1 };
const donor = { PK: 'TEST', SK: 'EMAIL#D#donor@example.org', GSI2PK: 'donor', GSI2SK: 'EMAIL#D#donor@example.org', GSI3PK: 'donor@example.org', type: 'donor', donorDetails: { firstName: 'Donor', lastName: 'Example' }, emailVerification: { hash: 'H#token', verified: false }, familyDetails: { request: [{ requestId: 'request', numberOfFamilies: 1, familyDetail: '["single"]', allocation: [] }] } };
const subscriber = { PK: 'donor@example.org', SK: 'H#token', subscribed: true, verified: true };
const template = { PK: 'welcome', SK: 'SK#welcome', subject: 'Welcome', pageContent: 'Hello', status: 'active' };
const decoded = r => JSON.parse(r.body);
const writes = f => f.calls.filter(c => c.name === 'Dynamo.write');
const batches = f => f.calls.filter(c => c.name === 'Dynamo.batchWrite').flatMap(c => c.args[0].map(x => x.PutRequest?.Item));
const defaultFunctions = { getEmailTemplate: async () => ({ subject: 'Test', pageContent: 'Test', pageTitle: 'Test' }) };
function fixture(endpoint, options = {}) { return setup(endpoint, { ...options, rows: clone(options.rows ?? []), functions: { ...defaultFunctions, ...options.functions } }); }

const cases = [
  { ep: 'campaign/create', body: { name: 'Campaign', reference: 'TEST' }, check: (f,r) => { assert.equal(writes(f)[0].args[0].PK, 'TEST'); assert.equal(decoded(r).campaign.type,'campaign'); } },
  { ep: 'campaign/update', body: { name: 'Renamed', campaignId: 'TEST', dates: { campaignStart: '2026-01-01', campaignEnd: '2026-12-31' } }, rows: [campaign], check: f => assert.equal(writes(f)[0].args[0].campaignName, 'Renamed') },
  { ep: 'campaign/delete', params: { campaignId: 'TEST' }, rows: [campaign], check: f => assert.equal(writes(f)[0].args[0].status,'deleted') },
  { ep: 'campaign/list', rows: [campaign, { ...campaign, PK:'OLD', status:'deleted' }], check: (f,r) => assert.equal(decoded(r).length,1) },
  { ep: 'campaign/verify', rows: [campaign, { ...campaign, PK:'OLD', status:'deleted' }], check: (f,r) => assert.deepEqual(decoded(r).campaignKeys,['TEST']) },
  { ep: 'campaign/getById', params: { campaignId: 'TEST' }, rows: [campaign,org,nom,family,donor], check: (f,r) => assert.equal(decoded(r).donors.length,1) },
  { ep: 'campaign/dashboard', params: { campaignId:'TEST' }, rows:[campaign,family,donor], check:(f,r) => {assert.equal(decoded(r).families,1);assert.equal(decoded(r).pledged,1);} },
  { ep: 'organisations/create', body:{ name:'New School', reference:'NEW', type:'school', campaignId:'TEST' }, rows:[campaign], check:f => assert.equal(writes(f)[0].args[0].organisation.name,'New School') },
  { ep: 'organisations/update', body:{ name:'Renamed', requestId:'org', campaign:'TEST' }, handlers:{'Dynamo.scan':async()=>[clone(campaign)],'Dynamo.query':async()=>[clone(org)]}, check:f=>assert.equal(writes(f)[0].args[0].organisation.name,'Renamed') },
  { ep: 'organisations/delete', params:{organisationId:'org'},body:{campaignId:'TEST'},rows:[org],check:f=>assert.equal(writes(f)[0].args[0].status,'deleted') },
  { ep: 'organisations/checkReference',params:{reference:'AB'},body:{campaignId:'TEST'},rows:[org],check:(f,r)=>assert.equal(decoded(r).reference,'AB1') },
  { ep: 'organisations/getByHash',params:{organisationId:'org',hash:Hashing.hash('org-data','test-saltorg-salt').hashedpassword},rows:[org],check:(f,r)=>assert.equal(decoded(r).campaignId,'TEST') },
  { ep: 'emails/create',body:{key:'welcome',subject:'Welcome',pageContent:'Hello'},check:f=>{assert.equal(writes(f)[0].args[1],'templates');assert.equal(writes(f)[0].args[0].PK,'welcome');} },
  { ep: 'emails/update',body:{key:'welcome',subject:'New subject',pageContent:'Hello'},rows:[template],check:f=>{assert.equal(writes(f)[0].args[0].pageTitle,'');assert.equal(writes(f)[0].args[1],'templates');} },
  { ep: 'emails/delete',params:{key:'welcome'},rows:[template],check:f=>{assert.equal(writes(f)[0].args[0].status,'deleted');assert.equal(writes(f)[0].args[1],'templates');} },
  { ep: 'emails/list',rows:[template,{...template,status:'deleted'}],check:(f,r)=>assert.equal(decoded(r).length,1) },
  { ep: 'hampers/check',body:{campaignId:'TEST',hamperId:'ABJD001'},handlers:{'Dynamo.scan':async()=>[clone(family)],'Dynamo.query':async()=>[]},check:(f,r)=>assert.equal(decoded(r).hamperId,'ABJD-001') },
  { ep: 'hampers/receive',body:{campaignId:'TEST',hamperId:'ABJD-001',noBags:'2'},rows:[family],check:f=>{assert.equal(writes(f)[0].args[0].bagsReceived,2);assert.equal(writes(f)[0].args[0].receiveStatus,'hamper-received');} },
  { ep: 'hampers/markDirect',body:{campaignId:'TEST',hamperId:'ABJD-001'},rows:[family],check:f=>assert.equal(writes(f)[0].args[0].receiveStatus,'direct-hamper') },
  { ep: 'hampers/markDirectBulk',body:{campaignId:'TEST',hamperIds:['ABJD-001','MISSING']},rows:[family],check:(f,r)=>{assert.equal(batches(f).length,1);assert.equal(decoded(r).errors[0].MISSING,'Hamper ID not found');} },
  { ep: 'hampers/screen',params:{campaignId:'TEST'},rows:[{...family,status:'allocated-confirmed',receiveStatus:'hamper-received',bagsReceived:2},{...family,status:'deleted',bagsReceived:4}],check:(f,r)=>assert.equal(decoded(r).bagsDropped,2) },
  { ep: 'hampers/overview',params:{hamperRef:'ABJD-001'},query:{campaignId:'TEST'},rows:[family],check:(f,r)=>assert.equal(decoded(r).hamper.reference,'ABJD-001') },
  { ep: 'hampers/undelivered',query:{campaignId:'TEST'},rows:[family,{...family,status:'deleted'}],check:(f,r)=>assert.equal(decoded(r).length,1) },
  { ep: 'hampers/undeliveredDonors',query:{campaignId:'TEST'},rows:[{...family,allocatedTo:'donor'},donor],check:(f,r)=>assert.equal(decoded(r)[0].pledged,1) },
  { ep: 'feedback/hamper',body:{campaignId:'TEST',feedback:'Thank you'},check:f=>assert.equal(writes(f)[0].args[0].type,'family') },
  { ep: 'feedback/volunteer',body:{campaignId:'TEST',positives:'Good',negatives:'None',improvements:'More signs',skills:'Driving',otherComments:'Thanks'},check:f=>assert.equal(writes(f)[0].args[0].type,'volunteer') },
  { ep: 'feedback/getHamper',params:{campaignId:'TEST'},rows:[{type:'family'},{type:'volunteer'}],check:(f,r)=>assert.equal(decoded(r).length,1) },
  { ep: 'feedback/getVolunteer',params:{campaignId:'TEST'},rows:[{type:'family'},{type:'volunteer'}],check:(f,r)=>assert.equal(decoded(r)[0].type,'volunteer') },
  { ep: 'feedback/generatePdf',body:{campaignId:'TEST'},check:(f,r)=>assert.equal(decoded(r).pdfUrl,'https://example.org/test.pdf') },
  { ep: 'feedback/hamperCheck',body:{hamperId:'AB-001',hamperHash:token('AB-001')},rows:[{requestId:'',feedback:'Received'}],check:(f,r)=>assert.equal(decoded(r).hasFeedback,true) },
  { ep: 'subscription/create',body:{firstname:'Jane',lastname:'Doe',email:'JANE@EXAMPLE.ORG'},check:f=>assert.equal(writes(f)[0].args[0].PK,'jane@example.org') },
  { ep: 'subscription/delete',params:{emailAddress:'donor@example.org'},rows:[subscriber],check:f=>assert.equal(f.calls.find(c=>c.name==='Dynamo.delete').args[0].SK,'H#token') },
  { ep: 'subscription/list',rows:[subscriber],check:(f,r)=>assert.equal(Object.values(decoded(r)).length,1) },
  { ep: 'subscription/check',params:{emailAddress:'donor@example.org',hash:token('H#token')},rows:[subscriber],check:(f,r)=>assert.equal(decoded(r).subscribed,true) },
  { ep: 'subscription/unsubscribe',params:{emailAddress:'donor@example.org',hash:token('H#token')},rows:[subscriber],check:f=>assert.equal(writes(f)[0].args[0].subscribed,false) },
  { ep: 'subscription/resubscribe',params:{emailAddress:'donor@example.org',hash:token('H#token')},rows:[{...subscriber,subscribed:false}],check:f=>assert.equal(writes(f)[0].args[0].subscribed,true) },
  { ep: 'subscription/subscribe',body:{firstname:'Jane',lastname:'Doe',email:'NEW@EXAMPLE.ORG'},check:f=>{assert.equal(writes(f)[0].args[1],'subscribers');assert.equal(writes(f)[0].args[0].verified,false);assert.equal(writes(f)[0].args[0].subscribed,false);assert.ok(f.calls.find(c=>c.name==='Notifications.sendTransactionalEmail').args[0].pageContent.includes('/subscription/verify/new%40example.org'));} },
  { ep: 'subscription/verification',groups:'',params:{emailAddress:'donor@example.org'},query:{v:token('token')},rows:[{...subscriber,verified:false,subscribed:false,pendingSubscription:true}],check:f=>{assert.equal(writes(f)[0].args[0].verified,true);assert.equal(writes(f)[0].args[0].subscribed,true);} },
  { ep: 'donors/register',body:{campaign:'TEST',firstname:'Jane',lastname:'Doe',email:'new@example.org',families:1,familyDetail:['single']},handlers:{'Dynamo.get':async()=>clone(campaign)},check:f=>{assert.equal(writes(f)[0].args[0].SK,'EMAIL#D#new@example.org');assert.equal(writes(f).length,2);} },
  { ep: 'donors/hide',body:{campaign:'TEST',donorId:'donor'},rows:[donor],check:f=>assert.equal(writes(f)[0].args[0].donorDetails.hidden,true) },
  { ep: 'donors/delete',body:{campaign:'TEST',donorId:'donor'},handlers:{'Dynamo.scan':async()=>[clone(donor)],'Dynamo.query':async()=>[{...clone(family),allocatedTo:'donor'}]},check:(f,r)=>{assert.equal(decoded(r).unallocatedFamilies,1);assert.equal(batches(f)[0].allocatedTo,'unallocated');assert.ok(f.calls.find(c=>c.name==='Dynamo.delete'));} },
  { ep: 'donors/emailUpdate',body:{campaign:'TEST',donorId:'donor',previousEmail:'donor@example.org',updatedEmail:'NEW@EXAMPLE.ORG'},rows:[donor],check:f=>{assert.equal(writes(f)[0].args[0].SK,'EMAIL#D#new@example.org');assert.equal(writes(f)[1].args[0].status,'deleted');} },
  { ep: 'donors/resendVerification',body:{campaign:'TEST',donorId:'donor'},handlers:{'Dynamo.scan':async()=>[clone(donor)],'Dynamo.query':async()=>[clone(subscriber)]},check:f=>assert.equal(writes(f)[0].args[0].emailVerification.verified,false) },
  { ep: 'donors/updatePledge',body:{campaignId:'TEST',donorId:'donor',campaignData:JSON.stringify([{requestId:'new-request',numberOfFamilies:2}])},rows:[donor],check:f=>assert.equal(writes(f)[0].args[0].familyDetails.request[0].numberOfFamilies,2) },
  { ep: 'donors/update',body:{campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',requestId:'request'},handlers:{'Dynamo.scan':async()=>[clone(family)],'Dynamo.query':async()=>[clone(donor)]},check:f=>assert.equal(writes(f)[0].args[0].familyDetails.request[0].allocation.length,1) },
  { ep: 'families/allocate',body:{campaignId:'TEST',donorId:'donor',hamperId:'ABJD-001',requestId:'request'},handlers:{'Dynamo.scan':async()=>[clone(family)],'Dynamo.query':async()=>[clone(donor)]},check:f=>{assert.equal(writes(f)[0].args[0].allocatedTo,'donor');assert.equal(writes(f)[1].args[0].familyDetails.request[0].allocation.length,1);} },
  { ep: 'families/create',body:{campaign:'TEST',nominator:'nom',nominations:[{hamperId:'ABJD-001',members:family.members}]},rows:[campaign,org,nom],check:f=>assert.equal(writes(f)[0].args[0].GSI3SK,'nom') },
  { ep: 'families/update',body:{campaign:'TEST',nominator:'nom',nominations:[{familyId:'family',members:[...family.members,{who:'Child',age:4}]}]},rows:[campaign,org,nom,family],check:f=>assert.equal(writes(f)[0].args[0].totalUnit,2) },
  { ep: 'families/delete',params:{familyId:'family'},rows:[family],check:f=>assert.equal(writes(f)[0].args[0].status,'deleted') },
  { ep: 'families/list',params:{campaignId:'TEST'},rows:[family,nom,donor,{...family,status:'deleted'}],check:(f,r)=>assert.equal(decoded(r).length,1) },
  { ep: 'families/emailAssignment',body:{donorId:'donor'},rows:[donor],check:f=>assert.ok(f.calls.find(c=>c.name==='Notifications.sendRawEmail')) },
  { ep: 'families/split',body:{campaign:'TEST',familyId:'family',members:[{who:'Adult',familyNumber:1},{who:'Adult',familyNumber:2,hamperId:'ABJD-001'},{who:'Child',familyNumber:2,hamperId:'ABJD-001'}]},rows:[campaign,org,nom,family],check:f=>{assert.equal(batches(f).length,2);assert.equal(batches(f)[0].members.length,2);assert.equal(batches(f)[0].GSI2SK,'SK#ABJD-002');} },
  { ep: 'nominators/approve',params:{organisationId:'org',nominatorId:'nom'},rows:[nom],check:f=>assert.equal(writes(f)[0].args[0].status,'Approved') },
  { ep: 'nominators/delete',params:{nominatorId:'nom'},rows:[{...nom,SK:'EMAIL#other@example.org',nominatorDetails:{...nom.nominatorDetails,email:'other@example.org'}}],check:f=>assert.ok(f.calls.find(c=>c.name==='Dynamo.delete')) },
  { ep: 'nominators/update',body:{requestId:'nom',campaignId:'TEST',firstName:'Renamed'},rows:[nom],check:f=>assert.equal(writes(f)[0].args[0].nominatorDetails.firstName,'Renamed') },
  { ep: 'nominators/resetPassword',params:{nominatorId:'nom'},rows:[nom],handlers:{'CognitoIdentityServiceProvider.listUsers':async()=>({Users:[{Username:'id'}]})},check:f=>assert.equal(f.calls.find(c=>c.name.endsWith('.adminSetUserPassword')).args[0].Username,'id') },
  { ep: 'nominators/sendWelcome',params:{userId:'nom'},handlers:{'Dynamo.scan':async p=>p.ExpressionAttributeValues[':gsi2pk']==='nom'?[clone(nom)]:[clone(org)]},check:f=>assert.ok(f.calls.find(c=>c.name==='Notifications.sendTransactionalEmail')) },
  { ep: 'nominators/create',body:{campaign:'TEST',organisationId:'org',type:'team-lead',firstname:'Jane',lastname:'Doe',email:'new@example.org'},rows:[campaign,org],check:f=>assert.equal(writes(f)[0].args[0].type,'team-lead') },
  { ep: 'users/create',params:{userType:'nominator'},body:{firstname:'Jane',lastname:'Doe',email:'new@example.org'},check:f=>assert.equal(f.calls.find(c=>c.name.endsWith('.adminAddUserToGroup')).args[0].GroupName,'Nominator') },
  { ep: 'users/list',params:{userType:'admin'},check:(f,r)=>assert.deepEqual(decoded(r),{}) },
  { ep: 'users/me',rows:[],check:(f,r)=>assert.equal(decoded(r).email,'actor@example.org') },
  { ep: 'users/delete',params:{organisationId:'none',emailAddress:'other@example.org',userType:'admin'},check:(f,r)=>assert.equal(decoded(r).success,true) },
  { ep: 'comms/sent',rows:[{PK:'EMAIL',email:{subject:'Hello'}}],check:(f,r)=>assert.equal(decoded(r).emails[0].email.subject,'Hello') },
];
for (const c of cases) {
  const run = f => { const input = event(c.body ?? {}, c.params ?? {}, c.groups ?? 'Admin'); input.queryStringParameters = c.query ?? {}; return f.invoke(input); };
  test(`${c.ep}: successful operation preserves its data contract`, async () => {
    const f=fixture(c.ep,c); const result=await run(f);
    assert.equal(result?.statusCode,200,JSON.stringify(f.logs)); c.check(f,result);
  });
  test(`${c.ep}: service failures never report a successful operation`, async () => {
    const baseline=fixture(c.ep,c); await run(baseline);
    const boundaries=[...new Set(baseline.calls.map(call=>call.name))];
    assert.ok(boundaries.length);
    for(const boundary of boundaries){
      const f=fixture(c.ep,{...c,fail:boundary}); const result=await run(f);
      assert.equal(result?.statusCode,400,`${boundary}: ${JSON.stringify(f.logs)}`);
    }
  });
}
