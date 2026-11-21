'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('./tools/node_modules/ssh2');
const credentials = fs.readFileSync('C:/Users/semen/Documents/ChatGPT/Героя Эфира sweb.txt', 'utf8');
const host = credentials.match(/IP-адрес\s*[:=]\s*((?:\d{1,3}\.){3}\d{1,3})/i)?.[1];
const username = credentials.match(/Логин\s*\(SSH\)\s*[:=]\s*(\S+)/i)?.[1];
const password = credentials.match(/^Пароль\s*[:=]\s*(.+)$/mi)?.[1]?.trim();
if (host !== '195.208.123.221' || username !== 'root' || !password) throw Error('Incomplete new VPS credentials');
const pinFile = path.join(__dirname, 'host-key.json');
const client = new Client();
const redact = text => String(text).split(password).join('[redacted]');
client.on('error', e => { console.error(redact(e.message)); process.exitCode = 1; });
client.on('ready', () => {
  const [mode, local, remote] = process.argv.slice(2);
  if (mode === 'exec') {
    const script = fs.readFileSync(local, 'utf8').replace(/\r\n/g, '\n');
    client.exec('bash -se', (error, stream) => {
      if (error) { console.error(redact(error.message)); process.exitCode = 1; client.end(); return; }
      stream.on('data', b => process.stdout.write(redact(b)));
      stream.stderr.on('data', b => process.stderr.write(redact(b)));
      stream.on('close', code => { process.exitCode = code || 0; client.end(); });
      stream.end(script);
    });
  } else if (mode === 'put' || mode === 'get') {
    if (!remote?.startsWith('/srv/heroether-test/')) throw Error('Remote path outside test stand');
    client.sftp((error, sftp) => {
      if (error) { console.error(redact(error.message)); process.exitCode=1; client.end(); return; }
      const done = error => { if(error) {console.error(redact(error.message));process.exitCode=1;} else console.log(mode+' complete'); client.end(); };
      if (mode === 'put') sftp.fastPut(local, remote, done); else sftp.fastGet(remote, local, done);
    });
  } else { client.end(); throw Error('Use exec script, put local remote, or get local remote'); }
});
client.connect({ host, port: 22, username, password, readyTimeout:20000,
  keepaliveInterval:15000, keepaliveCountMax:3,
  hostVerifier(key) {
    const fingerprint='SHA256:'+crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
    if(fs.existsSync(pinFile)) return JSON.parse(fs.readFileSync(pinFile)).fingerprint===fingerprint;
    fs.writeFileSync(pinFile,JSON.stringify({host,fingerprint,firstSeen:new Date().toISOString()},null,2),{flag:'wx'});
    console.log('Recorded first SSH host key: '+fingerprint);
    return true;
  }
});
