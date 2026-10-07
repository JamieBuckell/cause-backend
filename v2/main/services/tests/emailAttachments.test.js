const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

function notifications() {
  let raw;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../common/Notifications.js'), 'utf8'), {
    module, Buffer, console: { log() {} }, process: { env: { FROM_ADDRESS: 'sender@example.org', INTERNAL_ADDRESS: 'bcc@example.org' } },
    require: name => name === "./MailTracking" ? () => ({}) : name === 'crypto' ? require('node:crypto') : {
      config: { update() {} }, SES: function() { this.sendRawEmail = params => ({ promise: async () => { raw = params.RawMessage.Data; return {}; } }); },
    },
  });
  return { send: module.exports.sendRawEmail, getRaw: () => raw };
}
const parseMime = raw => {
  const result = spawnSync('python3', ['-c', `
import sys, json, base64
from email import policy
from email.parser import BytesParser
message = BytesParser(policy=policy.default).parsebytes(sys.stdin.buffer.read())
print(json.dumps({"type": message.get_content_type(), "defects": [str(d) for part in message.walk() for d in part.defects], "parts": [{"type": part.get_content_type(), "filename": part.get_filename(), "data": base64.b64encode(part.get_payload(decode=True)).decode()} for part in message.walk() if not part.is_multipart()]}))
`], { input: raw, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
for (const withPdf of [false, true]) test(`CSV attachment decodes byte-for-byte in a MIME parser${withPdf ? ' alongside PDF' : ''}`, async () => {
  // Synthetic family details only. Never commit recipient data from incident attachments.
  const csv = '"Hamper 1"\r\n"Family Member","Age","Additional Information"\r\n"Parent","35 Years","Café — warm clothes"\r\n'.repeat(30);
  const pdf = Buffer.from('%PDF-1.4\n\x00\xff\n%%EOF', 'latin1');
  const f = notifications();
  await f.send({ ToAddress: 'donor@example.org', subject: 'Your hampers', htmlContent: '<p>Thank you — here are your allocations.</p>', csvAttachment: csv, csvAttachmentFilename: 'your-allocation-families.csv', ...(withPdf ? { pdfAttachment: pdf.toString('base64'), pdfAttachmentFilename: 'labels.pdf' } : {}) });
  const raw = f.getRaw();
  assert.ok(!/(?<!\r)\n/.test(raw), 'MIME uses CRLF line endings');
  assert.ok(raw.split('\r\n').every(line => line.length < 998));
  const parsed = parseMime(raw);
  assert.equal(parsed.type, 'multipart/mixed');
  assert.deepEqual(parsed.defects, []);
  const attachment = parsed.parts.find(p => p.filename === 'your-allocation-families.csv');
  assert.equal(attachment.type, 'text/csv');
  assert.deepEqual(Buffer.from(attachment.data, 'base64'), Buffer.from(csv, 'utf8'));
  assert.equal(parsed.parts.filter(p => p.filename).length, withPdf ? 2 : 1);
  assert.ok(parsed.parts.some(p => p.type === 'text/plain'));
  assert.ok(parsed.parts.some(p => p.type === 'text/html'));
  if (withPdf) assert.deepEqual(Buffer.from(parsed.parts.find(p => p.filename === 'labels.pdf').data, 'base64'), pdf);
});
module.exports = { notifications, parseMime };
