// Read-only SDK checks against the installed reference map and prop library.
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({name:'shagged-discovery-validation',version:'1'});
const transport = new StdioClientTransport({command:process.execPath,args:['src/games/fps/scripts/shagged-mcp.mjs'],cwd:process.cwd(),stderr:'pipe'});
transport.stderr?.on('data', () => {});
async function call(name,args) {
  const result=await client.callTool({name,arguments:args},undefined,{timeout:120000});
  assert(!result.isError,JSON.stringify(result));
  return JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
}
try {
  await client.connect(transport);
  const tools=await client.listTools();
  for(const name of ['shagged_inspect_installed_map','shagged_models','shagged_entity_classes']) assert(tools.tools.some(t=>t.name===name));
  const map=await call('shagged_inspect_installed_map',{mapName:'wfdm5',limit:2});
  assert(map.ok && map.counts.faces>0 && map.spawns.length>0);
  assert.equal(map.palette.materials.length,2); assert.equal(map.palette.nextOffset,2);
  const next=await call('shagged_inspect_installed_map',{mapName:'wfdm5',offset:2,limit:2});
  assert(!map.palette.materials.some(a=>next.palette.materials.some(b=>a.name===b.name)));
  const lamp=await call('shagged_models',{search:'lamp',includeBounds:true,limit:10});
  assert(lamp.ok && lamp.total>0); assert(lamp.models.some(m=>m.bounds?.dimensions.every(n=>Number.isFinite(n)&&n>=0)));
  const compiler=await call('shagged_entity_classes',{compilerOnly:true});
  assert(compiler.every(c=>c.compilerOnly));
  for(const name of ['func_group','misc_decal','misc_text_decal','misc_model']) assert(compiler.some(c=>c.classname===name));
  assert.equal(compiler.find(c=>c.classname==='func_group').kind,'brush');
  const runtime=await call('shagged_entity_classes',{compilerOnly:false});
  assert(runtime.length>0 && runtime.every(c=>!c.compilerOnly));
  console.log(JSON.stringify({ok:true,map:map.mapName,faces:map.counts.faces,materials:map.palette.total,models:lamp.total,compilerClasses:compiler.map(c=>c.classname)},null,2));
} finally { await client.close(); }
