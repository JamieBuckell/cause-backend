const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clone } = require('./harness');
const { campaign,org,nom,family,donor,fixture,batches } = require('./fixtures');
const record = values => ({ Records: [{ messageAttributes: Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{stringValue:typeof v==='string'?v:JSON.stringify(v)}])) }] });
const email = { PK:'EMAIL',SK:'SORT#1',email:{subject:'Subject',title:'Title',content:'Content',type:'transactional'},dateAdded:'2026-01-01 12:00:00' };
const queueCases = [
  { ep:'comms/generate',input:record({emailId:'mail',emailRecipients:[{email:'recipient@example.org',SK:'H#subscriber'}],emailData:email}),boundary:'SQS.sendMessage',check:f=>assert.equal(f.calls.find(c=>c.name==='SQS.sendMessage').args[0].MessageAttributes.recipient.StringValue,'recipient@example.org') },
  { ep:'comms/mailer',input:record({emailId:'mail',recipient:'recipient@example.org',emailData:email}),boundary:'Notifications.sendTransactionalEmail',check:f=>{assert.equal(f.calls.find(c=>c.name==='Notifications.sendTransactionalEmail').args[0].ToAddresses[0],'recipient@example.org');assert.ok(f.calls.find(c=>c.name==='SQS.sendMessage'));} },
  { ep:'comms/complete',input:record({emailId:'mail',emailRecipients:[{email:'recipient@example.org'}],emailData:email}),boundary:'Dynamo.batchWrite',check:f=>assert.equal(batches(f)[0].GSI1PK,'mail') },
  { ep:'donors/sendPledgeDetail',input:record({donorDetails:donor,donorFamiliesData:[family]}),boundary:'Lambda.invoke',check:f=>{const sent=f.calls.find(c=>c.name==='Notifications.sendRawEmail');assert.equal(sent.args[0].ToAddress,'donor@example.org');assert.equal(Buffer.from(sent.args[0].pdfAttachment,'base64').toString(),'pdf-bytes');} },
  { ep:'users/doFixReferences',input:record({campaign:'TEST',nominatorId:'nom'}),rows:[campaign,org,nom,{...family,GSI2SK:'SK#WRONG'}],boundary:'Dynamo.scan',check:f=>assert.ok(f.calls.some(c=>c.name==='Dynamo.write'&&c.args[0].GSI2SK==='SK#ABJD-001')) },
];
for(const c of queueCases){
  test(`${c.ep}: valid queue message performs the intended action`,async()=>{const f=fixture(c.ep,c);const r=await f.invoke(c.input);assert.equal(r.statusCode,200,JSON.stringify(f.logs));c.check(f);});
  test(`${c.ep}: dependency failure rejects the batch for retry`,async()=>{const f=fixture(c.ep,{...c,fail:c.boundary});await assert.rejects(f.invoke(c.input));});
}
const migrations=[
  {ep:'dataMigration/addFamilyRequestIds',rows:[{...clone(donor),familyDetails:{request:[{requestId:'keep'},{numberOfFamilies:1}]}}],check:f=>{assert.equal(batches(f)[0].familyDetails.request[0].requestId,'keep');assert.ok(batches(f)[0].familyDetails.request[1].requestId);} },
  {ep:'dataMigration/fixFamilyUnitCounts',rows:[{...family,totalUnit:0}],check:f=>assert.equal(batches(f)[0].totalUnit,1)},
  {ep:'dataMigration/fixDonorCognitoIDs',rows:[{...nom,cognitoId:'legacy-id'}],check:f=>{assert.equal(batches(f)[0].nominatorDetails.cognitoId,'legacy-id');assert.ok(!batches(f)[0].cognitoId);}},
  {ep:'dataMigration/fixSKs',rows:[{...nom,GSI2SK:'EMAIL#actor@example.org'}],check:f=>assert.equal(batches(f)[0].GSI2SK,'SK#actor@example.org')},
  {ep:'dataMigration/fixFamilySKs',rows:[{...family,SK:'OLD'}],check:f=>{assert.equal(batches(f)[0].SK,'REF#family');assert.equal(batches(f)[1].status,'deleted');}},
  {ep:'dataMigration/removeDeletedFamilies',rows:[family,{...family,SK:'REF#deleted',status:'deleted'}],check:f=>{const dels=f.calls.filter(c=>c.name==='Dynamo.delete');assert.equal(dels.length,1);assert.equal(dels[0].args[0].SK,'REF#deleted');}},
  {ep:'dataMigration/donorAllocations',rows:[donor,{...family,allocatedTo:'donor'}],check:f=>assert.equal(batches(f)[0].familyDetails.request[0].allocation.length,1)},
  {ep:'dataMigration/subscribersFix',handlers:{'Dynamo.scan':async p=>p.TableName==='cause-donors-live'?[{requestId:'legacy',howHeard:'School'}]:p.TableName==='main'?[{...clone(donor),legacyId:'legacy'}]:[]},check:f=>assert.equal(batches(f)[0].donorDetails.howHeard,'School')},
  {ep:'dataMigration/organisations',rows:[{requestId:'legacy-org',reference:'AB',name:'School'}],check:f=>{assert.equal(batches(f)[0].type,'organisation');assert.equal(batches(f)[0].legacyId,'legacy-org');}},
  {ep:'dataMigration/nominators',handlers:{'Dynamo.scan':async p=>p.TableName==='cause-nominators-live'?[{requestId:'legacy-nom',organisationId:'legacy-org',emailAddress:'nom@example.org',firstName:'Jane',lastName:'Doe'}]:[{...clone(org),legacyId:'legacy-org'}]},check:f=>{assert.equal(batches(f)[0].GSI3PK,'org');assert.equal(batches(f)[0].SK,'EMAIL#nom@example.org');}},
  {ep:'dataMigration/families',handlers:{'Dynamo.scan':async p=>({main:[{...clone(org),legacyId:'legacy-org'},{...clone(nom),legacyId:'legacy-nom'}],'cause-donors-live':[],'cause-nominators-live':[{requestId:'legacy-nom'}],'cause-organisations-live-restored':[{requestId:'legacy-org'}],'cause-families-live':[{requestId:'legacy-family',reference:'ABJD-001',organisationId:'legacy-org',nominatorId:'legacy-nom'}],'cause-family-members-live':[{familyId:'legacy-family',who:'Adult'}]}[p.TableName]??[])},check:f=>{assert.equal(batches(f)[0].GSI3PK,'org');assert.equal(batches(f)[0].members.length,1);}},
  {ep:'dataMigration/donors',handlers:{'Dynamo.scan':async p=>({'cause-donors-live':[{requestId:'legacy-donor',email:'donor@example.org',firstName:'Jane',lastName:'Doe'}],'cause-campaign-donors-new-live':[{donorId:'legacy-donor',numberOfFamilies:1}]}[p.TableName]??[])},check:f=>{assert.equal(batches(f)[0].SK,'EMAIL#D#donor@example.org');assert.equal(batches(f)[1].PK,'donor@example.org');}},
  {ep:'dataMigration/deletedFamilies',rows:[family],check:f=>assert.equal(batches(f).length,0)},
  {ep:'comms/recipientFix',rows:[{PK:'RECIPIENT',SK:'SORT#1#a',emailAddress:'person@example.org',GSI1PK:'mail'},{PK:'RECIPIENT',SK:'SORT#1#b',emailAddress:'person@example.org',GSI1PK:'mail'}],check:f=>assert.equal(batches(f).length,0)},
  {ep:'comms/reconfigureEmails',rows:[{PK:'old-id',SK:'SORT#1',type:'email'}],check:f=>{const row=f.calls.find(c=>c.name==='Dynamo.write').args[0];assert.equal(row.PK,'EMAIL');assert.equal(row.GSI1PK,'old-id');}},
];
for(const c of migrations)test(`${c.ep}: transforms only its intended records`,async()=>{const f=fixture(c.ep,c);const r=await f.invoke({campaignId:'TEST'});assert.ok(r===undefined||r.statusCode===200,JSON.stringify(f.logs));c.check(f);});
test('donor allocation migration is idempotent for existing allocations',async()=>{
  const d=clone(donor);d.familyDetails.request[0].allocation=[{hamperId:'ABJD-001',members:family.members}];
  const f=fixture('dataMigration/donorAllocations',{rows:[d,{...family,allocatedTo:'donor'}]});await f.invoke({campaignId:'TEST'});assert.equal(batches(f).length,0);
});
