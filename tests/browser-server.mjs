// Isolated acceptance server. Credentials and AI responses below are test fixtures.
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle } from '../src/worker.js';
import { jpegInfo } from '../src/core.js';
import corpus from '../data/corpus.json' with {type:'json'};
const raw=new DatabaseSync(':memory:');raw.exec(readFileSync('migrations/0001_initial.sql','utf8'));
const DB={prepare(sql){let params=[];return {bind(...args){params=args;return this;},async first(){return raw.prepare(sql).get(...params)||null;},async all(){return {results:raw.prepare(sql).all(...params)};},async run(){return {meta:{changes:Number(raw.prepare(sql).run(...params).changes)}};}};}};
const env={DB,APP_SECRET:'a'.repeat(64),ADMIN_SETUP_TOKEN:'test-owner-bootstrap',RAG:{query:async()=>({matches:[{id:corpus.chunks[0].id,score:.9}]})},ASSETS:{fetch:async request=>{
  const path=decodeURIComponent(new URL(request.url).pathname),types={'.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg'};
  const ext=path.slice(path.lastIndexOf('.'));return new Response(readFileSync('public'+path),{headers:{'Content-Type':types[ext]||'text/html; charset=utf-8'}});
}}};
let scans=0;
async function fakeAI(url,options){
  if(url.endsWith('/predict')) {
    const bytes=new Uint8Array(await options.body.get('file').arrayBuffer()),info=jpegInfo(Buffer.from(bytes).toString('base64'));scans++;
    return Response.json({metadata:{task:'detect',classNames:['whiteheads','pustules']},images:[{shape:[info.height,info.width],results:[{class:scans%2?0:1,name:scans%2?'whiteheads':'pustules',confidence:.9,box:{x1:1,y1:1,x2:info.width-1,y2:info.height-1}}]}]});
  }
  if(url.endsWith(':embedContent'))return Response.json({embedding:{values:Array(768).fill(.1)}});
  const prompt=JSON.parse(options.body).contents.at(-1).parts[0].text;
  const data=JSON.parse(prompt.split('Dữ liệu tham khảo (JSON):\n')[1]),context=data.ket_qua_nhan_dien;
  const text=context ? `Ảnh ${context.chi_so_anh || 'tất cả'}: ${JSON.stringify(context)}\nTư vấn từ tài liệu [1].` : 'Chăm sóc da nhẹ nhàng, trao đổi bằng tiếng Việt [1].';
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
}
const server=http.createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const request=new Request('http://127.0.0.1:8788'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const output=await handle(request,env,{},fakeAI);res.writeHead(output.status,Object.fromEntries(output.headers));res.end(Buffer.from(await output.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Acceptance server error');}
});
server.listen(8788,'127.0.0.1',()=>console.log('Isolated Worker acceptance server ready on 8788; PID '+process.pid));
setTimeout(()=>server.close(()=>process.exit(0)),240000).unref();
