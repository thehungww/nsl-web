// Initial provisioning is performed on the owner's laptop. Nothing secret enters Git.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
function run(args, options={}) {
  const result=spawnSync(process.execPath,[wrangler,...args],{stdio:options.input!==undefined?['pipe','inherit','inherit']:'inherit',input:options.input,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if(result.status!==0) throw new Error('Cloudflare command failed: '+args.slice(0,2).join(' '));
}
const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
run(['whoami']);
if(config.d1_databases[0].database_id.startsWith('00000000')) {
  run(['d1','create','nsl-web','--binding=DB','--update-config']);
}
// An existing index is reusable; do not mask permission/network failures.
const info=spawnSync(process.execPath,[wrangler,'vectorize','get','nsl-acne-gemini-768'],{encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(info.status!==0) {
  if(!/vectorize\.index\.not_found|not found|does not exist/i.test((info.stdout || '')+(info.stderr || ''))) throw new Error('Cannot check Vectorize index; inspect Cloudflare permissions.');
  run(['vectorize','create','nsl-acne-gemini-768','--dimensions=768','--metric=cosine']);
}
run(['d1','migrations','apply','DB','--remote']);
let secrets;
if(existsSync('bootstrap.secret.json')) secrets=JSON.parse(readFileSync('bootstrap.secret.json','utf8'));
else {
  secrets={APP_SECRET:randomBytes(32).toString('hex'),ADMIN_SETUP_TOKEN:randomBytes(24).toString('hex')};
  writeFileSync('bootstrap.secret.json',JSON.stringify(secrets),{mode:0o600});
  writeFileSync('setup-private.txt','Mã thiết lập admin lần đầu (KHÔNG chia sẻ):\n'+secrets.ADMIN_SETUP_TOKEN+'\n',{mode:0o600});
}
run(['secret','bulk'],{input:JSON.stringify(secrets)});
if(!existsSync('data/vectors.ndjson')) throw new Error('Missing RAG vectors. Generate data/vectors.ndjson before deployment.');
run(['vectorize','upsert','nsl-acne-gemini-768','--file=data/vectors.ndjson']);
console.log('Initial setup complete. Run npm run deploy, then create admin using setup-private.txt.');
