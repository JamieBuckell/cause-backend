const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const moment = require(require.resolve('moment-timezone', { paths: [path.join(root, 'campaign'), path.join(root, 'comms')] }));
const clone = value => value === undefined ? value : JSON.parse(JSON.stringify(value));
const conditional = () => Object.assign(new Error('Condition failed'), { code: 'ConditionalCheckFailedException' });
function mailingFixture({ contacts = [], previous = [], originalOptions = {}, subscribers = [] } = {}) {
  const items = new Map(), calls = [], accepted = [], queued = [], cache = new Map();
  const faults = {};
  const key = value => `${value.PK}|${value.SK}`;
  function condition(item, expression, names = {}, values = {}) {
    if (!expression) return true;
    if (expression === 'attribute_not_exists(PK)') return !item;
    return expression.split(' AND ').every(term => {
      const [name, value] = term.split(' = ');
      return item?.[names[name] || name] === values[value];
    });
  }
  function update(item, params) {
    const next = { ...item, ...params.Key };
    for (const assignment of params.UpdateExpression.slice(4).split(', ')) {
      const [name, value] = assignment.split(' = ');
      next[params.ExpressionAttributeNames[name] || name] = params.ExpressionAttributeValues[value];
    }
    return next;
  }
  const db = {
    get: p => ({ promise: async () => { calls.push(['get',p]); return { Item: clone(items.get(key(p.Key))) }; } }),
    put: p => ({ promise: async () => {
      calls.push(['put',p]); const old=items.get(key(p.Item));
      if (!condition(old,p.ConditionExpression,p.ExpressionAttributeNames,p.ExpressionAttributeValues)) throw conditional();
      items.set(key(p.Item),clone(p.Item)); return {};
    } }),
    update: p => ({ promise: async () => {
      calls.push(['update',p]); const old=items.get(key(p.Key));
      if (!condition(old,p.ConditionExpression,p.ExpressionAttributeNames,p.ExpressionAttributeValues)) throw conditional();
      if (faults.update) await faults.update(p);
      items.set(key(p.Key),update(old,p));return {};
    } }),
    transactWrite: p => ({ promise: async () => {
      calls.push(['transaction',p]); if(faults.transaction) await faults.transaction(p);
      for(const op of p.TransactItems) if(op.Update&&!condition(items.get(key(op.Update.Key)),op.Update.ConditionExpression,op.Update.ExpressionAttributeNames,op.Update.ExpressionAttributeValues)) throw conditional();
      for(const op of p.TransactItems){if(op.Update)items.set(key(op.Update.Key),update(items.get(key(op.Update.Key)),op.Update));if(op.Put)items.set(key(op.Put.Item),clone(op.Put.Item));}
      if(faults.afterTransaction) await faults.afterTransaction(p);
      return {};
    } }),
  };
  const Dynamo = {
    query: async(p,table) => {
      calls.push(['query',p,table]);
      if(table==='main')return clone(contacts);
      const pk=p.ExpressionAttributeValues[':pk'];
      if(pk==='EMAIL'&&p.ExpressionAttributeValues[':id'])return [{email:{options:JSON.stringify(originalOptions)}}];
      if(pk==='RECIPIENT')return [...clone(previous),...[...items.values()].filter(r=>r.PK==='RECIPIENT')];
      return clone([...items.values()].filter(r=>r.PK===pk));
    },
    scan: async()=>clone(subscribers),
  };
  const AWS = { DynamoDB:{DocumentClient:function(){return db}},
    SQS:function(){return {sendMessage:p=>({promise:async()=>{if(faults.queue)await faults.queue(p);queued.push(clone(p));return {MessageId:'queued'};}})}},
    SES:function(config){calls.push(['sesConfig',config]);return {sendTemplatedEmail:p=>({promise:async()=>{calls.push(['ses',clone(p)]);if(faults.ses)await faults.ses(p);accepted.push(clone(p));return {MessageId:`ses-${accepted.length}`};}})}},
  };
  const env={COMMS_DYNAMO_TABLE:'comms',MAIN_DYNAMO_TABLE:'main',SUBSCRIBERS_TABLE:'subscribers',
    AWS_ACCOUNT_REGION:'eu-west-2',AWS_ACCOUNT_ID:'test',MAILER_QUEUE:'mailer',MAIL_PROCESSOR_QUEUE:'processor',
    APP_URL:'https://dev.example.org',TIMEZONE:'Europe/London',DATE_FORMAT:'YYYY-MM-DD HH:mm:ss',HASHING_SALT:'test'};
  function load(file) {
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const context={module,exports:module.exports,Buffer,process:{env},console:{log(){},error(){}},
      require(name){
        if(name==='aws-sdk')return AWS;
        if(name==='crypto')return crypto;
        if(name==='moment-timezone')return moment;
        const match=name.match(/(?:^|\/)(Dynamo|Functions|Notifications|Hashing)$/);
        if(match){if(match[1]==='Dynamo')return Dynamo;if(match[1]==='Functions')return {hasPermission:e=>e.admin!==false};if(match[1]==='Hashing')return {hash:()=>({hashedpassword:'unsubscribe-token'})};return {getEmailTemplate:async()=>''};}
        if(!name.startsWith('.'))throw Error('Unmocked dependency '+name);
        const common=name.match(/common\/(\w+)$/);
        return load(common?path.join(root,'common',common[1]+'.js'):path.resolve(path.dirname(file),name+'.js'));
      },
    };
    vm.runInNewContext(fs.readFileSync(file,'utf8'),context,{filename:file});return module.exports;
  }
  const invoke=async(name,input)=>load(path.join(root,'comms/endpoints',name+'.js')).handler(input);
  const request=async body=>{const r=await invoke('process',{body:JSON.stringify(body)});return {...JSON.parse(r.body),status:r.statusCode};};
  const packet=(body,id='message-1',group='group-1')=>({messageId:id,body:typeof body==='string'?body:JSON.stringify(body),attributes:{MessageGroupId:group}});
  return {items,calls,accepted,queued,faults,request,invoke,packet,loadCommon:name=>load(path.join(root,'common',name+'.js'))};
}
module.exports={mailingFixture};
