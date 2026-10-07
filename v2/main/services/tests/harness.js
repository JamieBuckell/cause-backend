const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const moment = require(require.resolve('moment-timezone', { paths: [path.join(root, 'campaign'), path.join(root, 'comms'), path.join(root, 'donors')] }));
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// All service boundaries are in-memory. Unexpected dependencies fail closed;
// these tests cannot use credentials, send mail, or reach AWS/the network.
function setup(endpoint, options = {}) {
  const calls = [], logs = [], cache = new Map();
  let identifier = 0;
  const env = {
    MAIN_DYNAMO_TABLE: 'main', SUBSCRIBERS_TABLE: 'subscribers', EMAIL_TEMPLATES_TABLE: 'templates',
    COMMS_DYNAMO_TABLE: 'comms', FEEDBACK_TABLE: 'feedback', FAMILIES_TABLE: 'families',
    DONORS_TABLE: 'donors', NOMINATORS_TABLE: 'nominators', FAMILY_MEMBERS_TABLE: 'members',
    CAMPAIGN_DONORS_TABLE: 'campaign-donors', EMAILS_TABLE: 'emails', EMAILS_SUBSCRIBERS_TABLE: 'email-subscribers',
    HASHING_SALT: 'test-salt', HASHING_PREFIX: 'H#', USER_POOL: 'pool', TIMEZONE: 'Europe/London',
    DATE_FORMAT: 'YYYY-MM-DD HH:mm:ss', APP_URL: 'https://example.org', DEFAULT_CAMPAIGN: 'TEST',
    AWS_ACCOUNT_REGION: 'eu-west-2', AWS_ACCOUNT_ID: 'test-account', MAILER_QUEUE: 'mailer',
    MAIL_PROCESSOR_QUEUE: 'processor', MAIL_COMPLETE_QUEUE: 'complete', PLEDGE_DETAIL_QUEUE: 'pledge',
    ...options.env,
  };
  async function call(name, args, fallback) {
    calls.push({ name, args: clone(args) });
    if (options.fail === name || options.fail === name.split('.')[0]) throw new Error(`Injected ${name} failure`);
    if (options.handlers?.[name]) return options.handlers[name](...args);
    return typeof fallback === 'function' ? fallback(...args) : clone(fallback);
  }
  const Dynamo = {};
  for (const name of ['scan', 'query', 'get', 'write', 'batchWrite', 'delete', 'reserveNominatorReference']) {
    Dynamo[name] = (...args) => call(`Dynamo.${name}`, args,
      name === 'scan' || name === 'query' ? options.rows ?? [] :
      name === 'reserveNominatorReference' ? true :
      name === 'get' ? () => { throw new Error('Item not found'); } : value => value);
  }
  const Notifications = {};
  for (const name of ['sendTransactionalEmail', 'sendRawEmail', 'sendInternalEmail', 'getEmailTemplate']) {
    Notifications[name] = (...args) => call(`Notifications.${name}`, args,
      name === 'getEmailTemplate' ? '{{pageTitle}}{{pageContent}}' : { MessageId: 'message' });
  }
  const AWS = { config: { update() {} } };
  for (const service of ['CognitoIdentityServiceProvider', 'SQS', 'Lambda', 'S3', 'SES']) {
    AWS[service] = function() {
      return new Proxy({}, { get(_, method) {
        return (...args) => ({ promise: () => call(`${service}.${String(method)}`, args,
          method === 'listUsers' || method === 'listUsersInGroup' ? { Users: [] } :
          method === 'adminGetUser' ? () => { const e = new Error('User not found'); e.code = 'UserNotFoundException'; throw e; } :
          method === 'adminCreateUser' ? { User: { Username: 'id', Attributes: [{ Name: 'sub', Value: 'id' }] } } :
          method === 'invoke' ? { Payload: JSON.stringify({ body: JSON.stringify({ pdfUrl: 'https://example.org/test.pdf', filename: 'test.pdf', location: 'test' }) }) } :
          method === 'getObject' ? { Body: 'pdf-bytes' } : {}) });
      } });
    };
  }
  AWS.DynamoDB = { DocumentClient: function() {
    return new Proxy({}, { get(_, method) {
      return (...args) => ({ promise: () => call(`DocumentClient.${String(method)}`, args, method === 'query' ? { Items: options.rows ?? [] } : {}) });
    } });
  } };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const context = { module, exports: module.exports, Buffer, URL, process: { env },
      console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
      setTimeout: fn => { fn(); return 1; }, clearTimeout() {},
      require(name) {
        if (/common\/Dynamo$/.test(name) || name === './Dynamo') return Dynamo;
        if (/common\/Notifications$/.test(name)) return Notifications;
        if (name === 'aws-sdk') return AWS;
        if (name === 'moment-timezone') return moment;
        if (name === 'nanoid') return { nanoid: () => `test-id-${++identifier}` };
        if (name === 'uuid') return { v4: () => `test-uuid-${++identifier}` };
        if (name === 'crypto') return require('node:crypto');
        if (name === 'https') return { get() { throw new Error('Network forbidden in tests'); } };
        if (name.startsWith('.')) {
          const common = name.match(/common\/(\w+)$/);
          const target = common ? path.join(root, 'common', common[1] + '.js') : path.resolve(path.dirname(file), name + '.js');
          return load(target);
        }
        throw new Error(`Unmocked dependency: ${name}`);
      },
    };
    vm.runInNewContext('"use strict";\n' + fs.readFileSync(file, 'utf8'), context, { filename: file });
    if (file.endsWith('/common/Functions.js')) {
      Object.assign(module.exports, options.functions);
    }
    return module.exports;
  }
  const handler = load(path.join(root, endpoint.replace('/', '/endpoints/') + '.js')).handler;
  const invoke = (event = {}) => handler(event, { awsRequestId: 'test-request' }, (error, result) => { if (error) throw error; return result; });
  return { invoke, calls, logs, env, loadCommon: name => load(path.join(root, 'common', name + '.js')) };
}
function event(body = {}, params = {}, groups = 'Admin') {
  return { body: JSON.stringify(body), pathParameters: params, queryStringParameters: {},
    requestContext: { authorizer: { claims: { email: 'actor@example.org', 'cognito:groups': groups } } } };
}
module.exports = { setup, event, root, clone };
