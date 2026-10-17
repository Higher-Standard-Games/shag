// Isolated authoring check; removes only its own uniquely named QA document.
import assert from 'node:assert/strict';
import {unlink} from 'node:fs/promises';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const mapName='qa_natural_'+Date.now();
const client=new Client({name:'shagged-natural-validation',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['scripts/shagged-mcp.mjs'],cwd:process.cwd(),stderr:'pipe'});
transport.stderr?.on('data',()=>{});
let created=false;
async function request(name,args) {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  return {error:!!result.isError,body:JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'))};
}
async function call(name,args) {const result=await request(name,args);assert(!result.error,JSON.stringify(result.body));return result.body;}
try {
  await client.connect(transport);
  const palette=await call('shagged_textures',{search:'concretebunker0068'});
  const texture=palette.textures.find(t=>t.size);assert(texture);
  await call('shagged_new_map',{mapName});created=true;
  await call('shagged_apply',{mapName,ops:[{op:'gen.room',id:'room',min:{x:0,y:0,z:0},max:{x:256,y:256,z:256},shader:texture.name,alignment:'natural'}]});
  const snapshot=(await call('shagged_read_document',{mapName})).document;
  assert(snapshot.brushes.every(b=>Object.values(b.faces).every(f=>JSON.stringify(f.size)===JSON.stringify(texture.size)&&f.scale.every(n=>n===0.5))));
  const invalid=await request('shagged_apply',{mapName,ops:[{op:'box.create',id:'invalid',min:{x:0,y:0,z:0},max:{x:16,y:16,z:16},shader:'qa/no_such_material',alignment:'natural'}]});
  assert(invalid.error);assert.deepEqual((await call('shagged_read_document',{mapName})).document,snapshot);
  console.log(JSON.stringify({ok:true,shader:texture.name,size:texture.size,brushes:snapshot.brushes.length,atomicRejection:true},null,2));
} finally {
  await client.close();
  if(created) await unlink(path.resolve('server-data/shagged/agent',mapName+'.json'));
}
