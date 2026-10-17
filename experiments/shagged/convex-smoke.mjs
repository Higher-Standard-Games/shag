// Real MCP authoring lifecycle; only its own uniquely named document is removed.
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const mapName='qa_convex_'+Date.now();
const client=new Client({name:'shagged-convex-validation',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['scripts/shagged-mcp.mjs'],cwd:process.cwd(),stderr:'pipe'});
transport.stderr?.on('data',()=>{});let created=false;
async function request(name,args){const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});return{error:!!r.isError,body:JSON.parse(r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'))};}
async function call(name,args){const r=await request(name,args);assert(!r.error,JSON.stringify(r.body));return r.body;}
try{
 await client.connect(transport);await call('shagged_new_map',{mapName});created=true;
 await call('shagged_apply',{mapName,ops:[
  {op:'box.create',id:'bridge',min:{x:-128,y:-16,z:32},max:{x:128,y:16,z:48},shader:'common/caulk'},
  {op:'brush.rotate',id:'bridge',axis:'z',degrees:45},
  {op:'gen.prism',id:'platform',footprint:[{x:160,y:0},{x:192,y:32},{x:160,y:64},{x:128,y:32}],bottom:0,top:32,shader:'common/caulk',alignment:'natural'},
  {op:'face.material',id:'platform',faces:[0,1],shader:'common/fullclip'},
  {op:'brushEntity.assign',id:'group',classname:'func_group',brushIds:['bridge','platform']},
 ]});
 const snapshot=(await call('shagged_read_document',{mapName})).document;
 assert(snapshot.brushes.every(b=>b.hull?.sides.length===6));
 const query=await call('shagged_query_objects',{mapName,ids:['bridge']});assert.equal(query.objects[0].ownerId,'group');assert(query.objects[0].data.hull);
 const rejected=await request('shagged_apply',{mapName,ops:[{op:'brush.carve',min:{x:0,y:0,z:32},max:{x:16,y:16,z:48}}]});
 assert(rejected.error);assert.deepEqual((await call('shagged_read_document',{mapName})).document,snapshot);
 console.log(JSON.stringify({ok:true,brushes:snapshot.brushes.length,numericSides:true,ownerQuery:true,atomicCutRejection:true},null,2));
}finally{await client.close();if(created)await unlink(path.resolve('server-data/shagged/agent',mapName+'.json'));}
