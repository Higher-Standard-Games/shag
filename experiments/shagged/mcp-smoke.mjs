// Run from the repository root. Native tools/media required. Publications/reports
// stay in .cache/; the QA document is created in the managed agent store.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const root=path.resolve('.cache/shagged-mcp-validation');
const mapName='qa_shagged_'+Date.now();
const env={...process.env,SHAGGED_MAPS_ROOT:path.join(root,'maps'),SHAGGED_PUBLISH_ROOT:path.join(root,'data')};
const clients=[];
async function open(){
 const client=new Client({name:'shagged-api-validation',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['src/games/fps/scripts/shagged-mcp.mjs'],cwd:process.cwd(),env,stderr:'pipe'});
 transport.stderr?.on('data',()=>{});await client.connect(transport);clients.push(client);return client;
}
async function request(client,name,args){
 const result=await client.callTool({name,arguments:args},undefined,{timeout:180000});
 return {failed:result.isError===true,body:JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'))};
}
async function call(client,name,args){const result=await request(client,name,args);assert(!result.failed&&result.body.ok!==false,JSON.stringify(result.body));return result.body;}
async function cli(args){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['node_modules/vite-node/vite-node.mjs','src/games/fps/cli/shagged.ts','--',...args],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',reject);child.on('close',code=>{try{resolve({code,body:JSON.parse(stdout.slice(stdout.search(/^\{/m))),stderr});}catch(error){reject(new Error(`${error}\n${stdout}\n${stderr}`));}});
 });
}
try{
 const a=await open();await call(a,'shagged_new_map',{mapName,template:'room'});
 const first=await call(a,'shagged_compile',{mapName,quality:'fast'});
 const reuse=await call(a,'shagged_compile',{mapName,quality:'fast'});
 const forced=await call(a,'shagged_compile',{mapName,quality:'fast',force:true});
 assert(!first.reused&&reuse.reused&&!forced.reused);assert.notEqual(first.packageName,forced.packageName);
 const b=await open();
 const status=await call(b,'shagged_compile_status',{jobId:first.jobId});assert.equal(status.state,'playable');
 let offset=0,transcript='';
 for(;;){const page=await call(b,'shagged_compile_log',{jobId:first.jobId,offset,limit:4096});transcript+=page.text;offset=page.nextOffset;if(offset>=page.size)break;}
 assert(transcript.includes('SHAGGED stage: makebsp')&&transcript.includes('Compiled FBSP v1'));
 let groups;
 if(process.argv.includes('--groups')) {
  const document=(await call(a,'shagged_read_document',{mapName})).document;
  const objectIds=document.brushes.slice(0,2).map(brush=>brush.id);
  const savedRoot=path.join(root,'maps',mapName),before=JSON.parse(fs.readFileSync(path.join(savedRoot,'current.json'),'utf8'));
  await call(a,'shagged_apply',{mapName,expectedRevision:document.revision,ops:[{op:'editorGroup.create',id:'qa_assembly',name:'Assembly',objectIds}]});
  const grouped=await call(a,'shagged_query_objects',{mapName,kinds:['editorGroup']});
  assert.equal(grouped.total,1);assert.deepEqual(grouped.objects[0].data.objectIds,objectIds);
  await call(a,'shagged_compile',{mapName,quality:'fast'});
  const after=JSON.parse(fs.readFileSync(path.join(savedRoot,'current.json'),'utf8'));
  assert.equal(after.sourceHash,before.sourceHash);assert(after.revision>before.revision);
  const sidecar=JSON.parse(fs.readFileSync(path.join(savedRoot,'revisions',after.snapshot,'editor.json'),'utf8'));
  assert.equal(sidecar.editorGroups[0].name,'Assembly');
  await call(a,'shagged_apply',{mapName,ops:[{op:'object.duplicate',ids:['qa_assembly'],delta:{x:16,y:0,z:0}},{op:'editorGroup.ungroup',ids:['qa_assembly-copy']},{op:'object.delete',ids:objectIds.map(id=>id+'-copy')}]});
  groups={query:true,unchangedCompilerSource:true,newSidecarRevision:true,duplicateUngroupDelete:true};
 }
 let csg;
 if(process.argv.includes('--csg')) {
  await call(a,'shagged_apply',{mapName,ops:[
   {op:'box.create',id:'qa_csg',min:{x:64,y:0,z:0},max:{x:128,y:64,z:64},shader:'common/caulk',detail:true},
   {op:'brush.clip',id:'qa_csg',plane:{normal:{x:1,y:0,z:0},distance:96},keep:'both'},
   {op:'box.create',id:'qa_csg_cutter',min:{x:88,y:-8,z:-8},max:{x:104,y:72,z:72}},
   {op:'brush.subtract',ids:['qa_csg','qa_csg-2'],cutterId:'qa_csg_cutter',removeCutter:true}
  ]});
  const query=await call(a,'shagged_query_objects',{mapName,ids:['qa_csg','qa_csg-2','qa_csg_cutter'],kinds:['brush']});
  assert.equal(query.total,2);assert.equal(query.objects.find(o=>o.data.id==='qa_csg').bounds.max.x,88);assert.equal(query.objects.find(o=>o.data.id==='qa_csg-2').bounds.min.x,104);
  const compiled=await call(a,'shagged_compile',{mapName,quality:'fast'});assert.equal(compiled.state,'playable');
  csg={split:true,subtract:true,cutterRemoved:true,compiled:true};
 }
 let round;
 if(process.argv.includes('--round')) {
  await call(a,'shagged_apply',{mapName,ops:[{op:'patch.round',id:'qa_round',shape:'tube',min:{x:-128,y:-64,z:0},max:{x:-64,y:0,z:64},thickness:8}]});
  const doc=(await call(a,'shagged_read_document',{mapName})).document;
  assert.equal(doc.patches.length,4);assert.equal(doc.editorGroups[0].objectIds.length,4);
  const bad=await request(a,'shagged_apply',{mapName,ops:[{op:'patch.round',shape:'tube',min:{x:0,y:0,z:0},max:{x:16,y:16,z:16},thickness:8}]});assert(bad.failed);
  assert.equal((await call(a,'shagged_read_document',{mapName})).document.revision,doc.revision);
  const compiled=await call(a,'shagged_compile',{mapName,quality:'fast'});assert.equal(compiled.state,'playable');
  round={surfaces:4,grouped:true,invalidRejected:true,compiled:true};
 }
 const initial=(await call(a,'shagged_read_document',{mapName})).document;
 const controls=[0,1,2].map(row=>[0,1,2].map(col=>({x:col*8,y:row*8,z:160,u:col/2,v:row/2})));
 await call(a,'shagged_apply',{mapName,expectedRevision:initial.revision,ops:[
  {op:'world.keys',keys:{message:'Inspection QA'}},
  {op:'box.create',id:'qa_detail',min:{x:-8,y:-8,z:0},max:{x:8,y:8,z:16},shader:'common/caulk',detail:true},
  {op:'face.material',id:'qa_detail',faces:'all',shader:'common/caulk'},
  {op:'patch.create',id:'qa_curve',shader:'common/caulk',width:3,height:3,controlPoints:controls},
  {op:'brushEntity.assign',id:'qa_group',classname:'func_group',brushIds:['qa_detail'],keys:{chamfer_convexwidth:'2'}}
 ]});
 const snapshot=(await call(a,'shagged_read_document',{mapName})).document;
 const info=await call(a,'shagged_map_info',{mapName,objects:true});
 assert.deepEqual(info.patches,snapshot.patches);assert.deepEqual(info.brushes,snapshot.brushes);assert.deepEqual(info.brushEntities,snapshot.brushEntities);
 assert.deepEqual(snapshot.patches.find(p=>p.id==='qa_curve').controlPoints,controls);
 assert(snapshot.brushes.find(p=>p.id==='qa_detail').faces);
 const query=await call(a,'shagged_query_objects',{mapName,bounds:{min:{x:-8,y:-8,z:0},max:{x:8,y:8,z:16}},relation:'contained',kinds:['brush','brushEntity']});
 assert.equal(query.total,2);assert.equal(query.objects.find(o=>o.kind==='brush').ownerId,'qa_group');
 const ids=[];let next=0;
 do{const page=await call(a,'shagged_query_objects',{mapName,offset:next,limit:2});assert.equal(page.revision,snapshot.revision);ids.push(...page.objects.map(o=>o.data.id));next=page.nextOffset;}while(next!==null);
 assert.equal(new Set(ids).size,ids.length);assert(ids.includes('qa_curve'));
 const ops=[{op:'world.keys',keys:{message:'Concurrent inspection QA'}}];
 const concurrent=await Promise.all([request(a,'shagged_apply',{mapName,ops,expectedRevision:snapshot.revision}),request(b,'shagged_apply',{mapName,ops,expectedRevision:snapshot.revision})]);
 assert.equal(concurrent.filter(result=>result.failed).length,1);
 const current=(await call(a,'shagged_read_document',{mapName})).document;assert.equal(current.revision,snapshot.revision+1);
 assert((await request(a,'shagged_query_objects',{mapName,bounds:{min:{x:2,y:0,z:0},max:{x:1,y:0,z:0}}})).failed);
 const file=path.join(root,'snapshot.json'),opsFile=path.join(root,'ops.json');
 fs.writeFileSync(file,JSON.stringify(current));fs.writeFileSync(opsFile,JSON.stringify(ops));
 const read=await cli(['read',file]);assert.equal(read.code,0);assert.deepEqual(read.body.document,current);
 const before=fs.readFileSync(file,'utf8');const stale=await cli(['apply',file,opsFile,'--expected-revision',String(snapshot.revision)]);
 assert.equal(stale.code,1);assert.equal(stale.body.error,'Map revision conflict');assert.equal(fs.readFileSync(file,'utf8'),before);
 const cliConcurrent=await Promise.all([cli(['apply',file,opsFile,'--expected-revision',String(current.revision)]),cli(['apply',file,opsFile,'--expected-revision',String(current.revision)])]);
 assert.equal(cliConcurrent.filter(result=>result.code===0).length,1);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).revision,current.revision+1);
 const summary={ok:true,mapName,first:first.packageName,reused:reuse.reused,forced:forced.packageName,transcriptBytes:offset,groups,csg,round,inspection:{patches:info.patches.length,spatialMatches:query.total,pagedObjects:ids.length,concurrentWinners:1,cliRoundTrip:true,staleCliRejected:true,cliConcurrentWinners:1}};
 fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
}finally{await Promise.allSettled(clients.map(client=>client.close()));}
