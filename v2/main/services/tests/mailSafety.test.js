const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mailingFixture}=require('./mailSafetyHarness');
const id='a'.repeat(32), id2='b'.repeat(32);
const contact=(email,type='nominator',status)=>({type,status,nominatorDetails:{email},GSI3PK:email});
const input=(options={},requestId=id)=>({action:'preview',requestId,email:{subject:'Deadline',title:'Deadline',content:'Body'},options:{type:'nominators',campaignId:'CHC2026',excludeTeamLeads:true,...options}});
async function confirmed(f,options={}){const p=await f.request(input(options));assert.equal(p.status,200);const s=await f.request({action:'send',requestId:id});assert.equal(s.status,200);return p;}
const delivery=(f,email,requestId=id,messageId='one')=>f.packet({version:2,runId:requestId,email},messageId,email);
for(const [type,expected] of [['donors',['donor@example.org']],['nominators',['nom@example.org']],['teamleads',['lead@example.org']]])test(`selects ${type} only`,async()=>{
 const f=mailingFixture({contacts:[contact('donor@example.org','donor'),contact('nom@example.org'),contact('lead@example.org','team-lead'),contact('deleted@example.org','nominator','deleted')]});
 const p=await f.request(input({type}));assert.equal(p.status,200);assert.deepEqual(p.recipients.map(r=>r.email),expected);assert.equal(f.queued.length,0);assert.equal(f.accepted.length,0);
});
test('includes team leads only when requested and deduplicates shared addresses',async()=>{
 const f=mailingFixture({contacts:[contact(' Nom@Example.org '),contact('nom@example.org','team-lead'),contact('lead@example.org','team-lead')]});
 const p=await f.request(input({excludeTeamLeads:false}));assert.equal(p.count,2);assert.equal(p.duplicateCount,1);assert.equal(p.recipients[1].roles.length,2);
});
test('missing campaign is rejected, but a resend recovers the original campaign',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')],originalOptions:{type:'nominators',campaignId:'CHC2026',excludeTeamLeads:true}});
 assert.equal((await f.request(input({campaignId:null}))).status,400);
 const p=input();delete p.options.campaignId;p.existingEmailId='original';assert.equal((await f.request(p)).status,200);
});
test('missing or malformed addresses prevent sending rather than silently dropping nominators',async()=>{
 const f=mailingFixture({contacts:[contact('good@example.org'),contact('bad'),contact(undefined)]});const p=await f.request(input());assert.equal(p.invalidCount,2);assert.equal((await f.request({action:'send',requestId:id})).status,400);assert.equal(f.queued.length,0);
});
test('resend defaults to unsent addresses using normalised sent records',async()=>{
 const f=mailingFixture({contacts:[contact('old@example.org'),contact('new@example.org')],previous:[{emailAddress:' OLD@EXAMPLE.ORG '}]});
 const p=input();p.existingEmailId='original';const r=await f.request(p);assert.equal(r.count,1);assert.equal(r.previouslySentCount,1);assert.equal(r.recipients[0].email,'new@example.org');
});
test('intentional resend previews previous recipients with a distinct run ID',async()=>{
 const f=mailingFixture({contacts:[contact('old@example.org')],previous:[{emailAddress:'old@example.org'}]});const p=input({ignorePreviouslySent:true});p.existingEmailId='original';const r=await f.request(p);assert.equal(r.count,1);assert.equal(r.includesPreviouslySent,true);
});
test('unauthorised requests and legacy unconfirmed sends have no side effects',async()=>{
 const f=mailingFixture();assert.equal((await f.invoke('process',{admin:false,body:JSON.stringify(input())})).statusCode,401);assert.equal(f.items.size,0);
 assert.equal((await f.request({email:input().email,options:input().options})).status,400);assert.equal(f.items.size,0);
});
test('confirmation uses the frozen preview and repeated confirmation does not queue again',async()=>{
 const contacts=[contact('original@example.org')];const f=mailingFixture({contacts});await f.request(input());contacts.push(contact('late@example.org'));
 await f.request({action:'send',requestId:id});const n=f.queued.length;await f.request({action:'send',requestId:id});assert.equal(f.queued.length,n);assert.equal(f.items.get('MAIL_RUN|'+id).recipients.length,1);
 const changed=input();changed.email.content='Changed';assert.equal((await f.request(changed)).status,400);
});
test('partial queue publication can be retried using the same run',async()=>{
 const contacts=Array.from({length:101},(_,i)=>contact(`n${i}@example.org`));const f=mailingFixture({contacts});await f.request(input());let calls=0;f.faults.queue=async()=>{if(++calls===2)throw Error('network');};assert.equal((await f.request({action:'send',requestId:id})).status,400);delete f.faults.queue;assert.equal((await f.request({action:'send',requestId:id})).status,200);assert.equal(f.items.get('MAIL_RUN|'+id).status,'QUEUED');
});
test('generator retries reuse stable FIFO identities and confirmed recipients',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);const packet=f.packet(f.queued[0].MessageBody);await f.invoke('generate',{Records:[packet]});await f.invoke('generate',{Records:[packet]});const sends=f.queued.filter(q=>q.MessageDeduplicationId);assert.equal(sends.length,2);assert.equal(sends[0].MessageDeduplicationId,sends[1].MessageDeduplicationId);
});
test('successful recipient is not sent again on batch retry after another fails',async()=>{
 const f=mailingFixture({contacts:[contact('first@example.org'),contact('second@example.org')]});await confirmed(f);let failed=false;f.faults.ses=async p=>{if(p.Destination.ToAddresses[0]==='second@example.org'&&!failed){failed=true;throw Object.assign(Error('throttle'),{code:'Throttling'});}};
 const event={Records:[delivery(f,'first@example.org',id,'first'),delivery(f,'second@example.org',id,'second')]};const result=await f.invoke('mailer',event);assert.deepEqual(JSON.parse(JSON.stringify(result.batchItemFailures)),[{itemIdentifier:'second'}]);await f.invoke('mailer',event);assert.equal(f.accepted.length,2);assert.equal(f.accepted.filter(p=>p.Destination.ToAddresses[0]==='first@example.org').length,1);
});
test('concurrent workers can send a recipient only once',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);const event={Records:[delivery(f,'nom@example.org')]};await Promise.all([f.invoke('mailer',event),f.invoke('mailer',event)]);assert.equal(f.accepted.length,1);
});
test('accepted send followed by storage failure is held for review, never automatically resent',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);f.faults.transaction=async()=>{throw Error('database unavailable')};const event={Records:[delivery(f,'nom@example.org')]};assert.equal((await f.invoke('mailer',event)).batchItemFailures.length,1);delete f.faults.transaction;await f.invoke('mailer',event);assert.equal(f.accepted.length,1);assert.equal(f.items.get('MAIL_DELIVERY#'+id+'|nom@example.org').status,'UNCERTAIN');
});
test('lost transaction acknowledgement detects a committed send and does not repeat it',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);f.faults.afterTransaction=async()=>{throw Error('lost acknowledgement')};const event={Records:[delivery(f,'nom@example.org')]};assert.equal((await f.invoke('mailer',event)).batchItemFailures.length,0);await f.invoke('mailer',event);assert.equal(f.accepted.length,1);
});
test('ambiguous SES network result and a crashed SENDING claim are never retried automatically',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);f.faults.ses=async()=>{throw Object.assign(Error('timeout'),{code:'TimeoutError'})};const event={Records:[delivery(f,'nom@example.org')]};await f.invoke('mailer',event);delete f.faults.ses;await f.invoke('mailer',event);assert.equal(f.calls.filter(c=>c[0]==='ses').length,1);assert.equal(f.items.get('MAIL_DELIVERY#'+id+'|nom@example.org').status,'UNCERTAIN');assert.equal(f.calls.find(c=>c[0]==='sesConfig')[1].maxRetries,0);
});
test('permanent SES rejection is recorded and not repeatedly sent',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);f.faults.ses=async()=>{throw Object.assign(Error('rejected'),{code:'MessageRejected'})};const event={Records:[delivery(f,'nom@example.org')]};await f.invoke('mailer',event);await f.invoke('mailer',event);assert.equal(f.calls.filter(c=>c[0]==='ses').length,1);assert.equal(f.items.get('MAIL_DELIVERY#'+id+'|nom@example.org').status,'FAILED');
});
test('FIFO partial response holds later records in the failed group but processes other groups',async()=>{
 const f=mailingFixture();const worker=f.loadCommon('MailWorker');const calls=[];const result=await worker.batch({Records:[f.packet({},'one','a'),f.packet({},'two','a'),f.packet({},'three','b')]},async r=>{calls.push(r.messageId);if(r.messageId==='one')throw Error('fail')},true);assert.deepEqual(calls,['one','three']);assert.equal(result.batchItemFailures.length,2);
});
test('legacy queue payloads and recipients outside the confirmed list never send',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);const r=await f.invoke('mailer',{Records:[f.packet('legacy'),delivery(f,'other@example.org')]});assert.equal(r.batchItemFailures.length,2);assert.equal(f.accepted.length,0);
});
test('an explicit new resend run can send a second copy, but its own retries cannot',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await confirmed(f);await f.invoke('mailer',{Records:[delivery(f,'nom@example.org')]});const p=input({ignorePreviouslySent:true},id2);p.existingEmailId=id;await f.request(p);await f.request({action:'send',requestId:id2});const event={Records:[delivery(f,'nom@example.org',id2)]};await f.invoke('mailer',event);await f.invoke('mailer',event);assert.equal(f.accepted.length,2);assert.equal([...f.items.values()].filter(r=>r.PK==='EMAIL').length,1);
});
test('two pending unsent-only resends of one mailing share recipient protection',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});
 for(const requestId of [id,id2]){const p=input({},requestId);p.existingEmailId='original';assert.equal((await f.request(p)).status,200);await f.request({action:'send',requestId});}
 await Promise.all([f.invoke('mailer',{Records:[delivery(f,'nom@example.org',id)]}),f.invoke('mailer',{Records:[delivery(f,'nom@example.org',id2)]})]);assert.equal(f.accepted.length,1);
});
test('preview snapshot expires before confirmation and cannot send',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});await f.request(input());f.items.get('MAIL_RUN|'+id).createdAt=0;assert.equal((await f.request({action:'send',requestId:id})).status,400);assert.equal(f.queued.length,0);
});
test('subscriber preview excludes pledged donors and retains unsubscribe token source',async()=>{
 const f=mailingFixture({contacts:[contact('donor@example.org','donor')],subscribers:[{PK:' DONOR@example.org ',SK:'one',subscribed:true,verified:true},{PK:'sub@example.org',SK:'two',subscribed:true,verified:true},{PK:'deleted@example.org',SK:'three',subscribed:true,verified:true,status:'deleted'}]});const p=await f.request(input({type:'subscribers',excludePledged:true}));assert.equal(p.count,1);assert.equal(p.recipients[0].email,'sub@example.org');await f.request({action:'send',requestId:id});await f.invoke('mailer',{Records:[delivery(f,'sub@example.org')]});assert.equal(f.accepted[0].Template,'CauseFSubscriber');assert.ok(JSON.parse(f.accepted[0].TemplateData).unsubscribeLink.includes('unsubscribe-token'));
});
test('donor preview can exclude subscribers using normalised addresses',async()=>{
 const f=mailingFixture({contacts:[contact('sub@example.org','donor'),contact('other@example.org','donor')],subscribers:[{PK:' SUB@example.org ',subscribed:true}]});const p=await f.request(input({type:'donors',excludeSubscribers:true}));assert.equal(p.count,1);assert.equal(p.recipients[0].email,'other@example.org');
});
test('sent status distinguishes accepted, failed, pending and ambiguous deliveries',async()=>{
 const f=mailingFixture({contacts:[contact('one@example.org'),contact('two@example.org')]});await confirmed(f);await f.invoke('mailer',{Records:[delivery(f,'one@example.org')]});f.items.set('MAIL_DELIVERY#'+id+'|two@example.org',{PK:'MAIL_DELIVERY#'+id,SK:'two@example.org',status:'UNCERTAIN'});const response=await f.invoke('sent',{});const email=Object.values(JSON.parse(response.body).emails)[0];assert.match(email.deliveryStatus,/1\/2 accepted, 0 pending, 0 failed, 1 need review/);
});
test('preview endpoint cannot send even when asked to confirm',async()=>{
 const f=mailingFixture({contacts:[contact('nom@example.org')]});const p={...input(),action:'send'};const r=await f.invoke('preview',{body:JSON.stringify(p)});assert.equal(r.statusCode,200);assert.equal(f.queued.length,0);assert.equal(f.accepted.length,0);assert.equal(f.items.get('MAIL_RUN|'+id).status,'PREVIEW');
});
