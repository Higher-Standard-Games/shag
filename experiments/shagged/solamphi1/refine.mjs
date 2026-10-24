// Iterative refinement, through SHAGGED MCP. Run from repository root.
import fs from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const mapName='solamphi1', output='experiments/shagged/solamphi1', stage=process.argv[2];
if(!['asset-probe','compact','basins','architecture','dressing','atmosphere','optimize','lighting','hero','reactor-finish','report'].includes(stage))throw new Error('Unknown refinement stage');
fs.mkdirSync(`${output}/refinement`,{recursive:true});
const doc=JSON.parse(fs.readFileSync(`${output}/solamphi1.json`,'utf8'));
const v=(x,y,z)=>({x,y,z});
const ops=[];
const box=(id,min,max,shader)=>ops.push({op:'box.create',id,min:v(...min),max:v(...max),shader});
const material=(id,faces,shader)=>ops.push({op:'face.material',id,faces,shader});
const entity=(id,classname,origin,keys={})=>ops.push({op:'entity.place',id,classname,origin:v(...origin),keys});
const model=(id,path,origin,scale=1,angle=0)=>entity(id,'misc_model',origin,{model:'models/mapobjects/'+path,collisiontype:'none',spawnflags:'4',modelscale:String(scale),angle:String(angle),samplesize:'8'});
const light=(id,origin,color,power)=>entity(id,'light',origin,{_color:color,light:String(power)});
const steel='exwsw/matte_eX_surf_metaldarkgrey', concrete='concrete/concretebunker0068', brick='bricks/redbricks_base_01';
if(stage==='asset-probe')model('ase-lamp-probe','wdm5/wdm5_WallLamp1.ase',[0,-1080,400],1,0);
if(stage==='compact'){
 const scale=.75, scaled=p=>v(p.x*scale,p.y*scale,p.z*scale);
 for(const b of doc.brushes)ops.push({op:'box.update',id:b.id,min:scaled(b.min),max:scaled(b.max)});
 for(const e of doc.entities){
  const keys={};
  if(e.classname==='misc_model')keys.modelscale=String(Number(e.keys.modelscale??1)*scale);
  if(e.classname==='light')keys.light=String(Math.round(Number(e.keys.light??300)*scale*scale));
  ops.push({op:'entity.update',id:e.id,origin:scaled(e.origin),keys});
 }
 if(doc.patches?.length)ops.push({op:'object.delete',ids:doc.patches.map(p=>p.id)});
 for(const p of doc.patches??[])ops.push({op:'patch.create',...p,controlPoints:p.controlPoints.map(row=>row.map(p=>({...p,...scaled(p)})))});
}
if(stage==='basins'){
 for(const sx of[-1,1])for(const sy of[-1,1]){
  const xr=sx<0?[-656,-288]:[288,656],yr=sy<0?[-656,-288]:[288,656];
  const id=`slime-${sx}-${sy}`;
  ops.push({op:'brush.carve',min:v(xr[0],yr[0],-32),max:v(xr[1],yr[1],0)});
  box(`${id}-bottom`,[xr[0],yr[0],-48],[xr[1],yr[1],-44],concrete);
  box(`${id}-volume`,[xr[0],yr[0],-44],[xr[1],yr[1],-8],'ETRtex/slime2');
  material(`${id}-volume`,'all','ETRtex/slime2');
  ops.push({op:'gen.stairs',id:`${id}-exit`,from:v(sx*384,sy*480,-44),to:v(sx*288,sy*480,0),width:96,step:12,shader:concrete});
  light(`${id}-bounce`,[sx*496,sy*496,72],'0.25 0.65 0.08',100);
 }
}
if(stage==='architecture'){
 // Replace the flat signage block with the original shaped, emissive map prop.
 ops.push({op:'object.delete',ids:['ase-lamp-probe','nats-sign']});
 model('nats-bar-shaped','wdm5/wdm5_SignNatsBar.ase',[-826,432,316],1.25,0);
 ops.push({op:'box.update',id:'reactor-clip',min:v(-104,-104,192),max:v(104,104,420)});
 for(const x of[-88,88])for(const y of[-88,88])model(`reactor-leg-${x}-${y}`,'wdm5/wdm5_pillar1.ase',[x,y,300],1,y<0?0:180);
 for(const axis of['x','y'])for(const side of[-1,1]){
  const r=side<0?[-840,-816]:[816,840];
  const facing=axis==='x'?(side<0?'+X':'-X'):(side<0?'+Y':'-Y');
  // Brick pilasters, concrete plinth and roof coping give the court real construction depth.
  for(const c of[-720,-480,-240,0,240,480,720]){
   const id=`masonry-${axis}-${side}-${c}`;
   box(id,axis==='x'?[r[0],c-12,0]:[c-12,r[0],0],axis==='x'?[r[1],c+12,408]:[c+12,r[1],408],brick);
   material(id,'all',brick);
  }
  box(`plinth-${axis}-${side}`,axis==='x'?[r[0],-816,0]:[-840,r[0],0],axis==='x'?[r[1],816,40]:[840,r[1],40],concrete);
  box(`coping-${axis}-${side}`,axis==='x'?[r[0]-4,-840,384]:[-840,r[0]-4,384],axis==='x'?[r[1]+4,840,400]:[840,r[1]+4,400],steel);
  // Real lamp models, brackets, rooftop windows and air conditioning units.
  for(const c of[-600,-120,360]){
   const angle=axis==='x'?(side<0?-90:90):(side<0?0:180);
   const pos=axis==='x'?[side*820,c,300]:[c,side*820,300];
   model(`lamp-${axis}-${side}-${c}`,'wdm5/wdm5_WallLamp1.ase',pos,.75,angle);
   const lampLight=axis==='x'?[side*768,c,280]:[c,side*768,280];
   light(`lamp-pool-${axis}-${side}-${c}`,lampLight,'1 0.69 0.39',145);
  }
  for(const c of[-360,120,600]){
   const pos=axis==='x'?[side*824,c,320]:[c,side*824,320];
   const angle=axis==='x'?(side<0?-90:90):(side<0?0:180);
   model(`factory-window-${axis}-${side}-${c}`,'wdm5/wdm5_MiddleAreaRooftopWindow.ase',pos,.8,angle);
  }
  const p=axis==='x'?[side*824,216,366]:[216,side*824,366];
  model(`aircon-${axis}-${side}`,'decor_misc/aircondition_01.ase',p,.8,axis==='x'?(side<0?-90:90):(side<0?0:180));
  // Deep shutter frames read as closed maintenance entrances, with sills and weather caps.
  const a=side<0?[-816,-804]:[804,816];
  for(const c of[-96,90])box(`shutter-jamb-${axis}-${side}-${c}`,axis==='x'?[a[0],c,192]:[c,a[0],192],axis==='x'?[a[1],c+6,336]:[c+6,a[1],336],concrete);
  box(`shutter-cap-${axis}-${side}`,axis==='x'?[a[0],-96,336]:[-96,a[0],336],axis==='x'?[a[1],96,348]:[96,a[1],348],concrete);
 }
 // Vertical service pipes run into the basin edges; these have proper collars and feet.
 for(const side of[-1,1])for(const y of[-624,624]){
  const x=side*776;
  for(let q=0;q<4;q++){
   const a=q*Math.PI/2,b=a+Math.PI/2,rad=8;
   const profile=[[Math.cos(a),Math.sin(a)],[Math.cos(a)+Math.cos(b),Math.sin(a)+Math.sin(b)],[Math.cos(b),Math.sin(b)]];
   ops.push({op:'patch.create',id:`downpipe-${side}-${y}-${q}`,shader:'metal/metalrust_iron6',width:3,height:3,
    controlPoints:[8,188,368].map((z,row)=>profile.map(([dx,dy],col)=>({x:x+rad*dx,y:y+rad*dy,z,u:(q*2+col)/8,v:row*2})))});
  }
  for(const z of[16,176,336])box(`pipe-collar-${side}-${y}-${z}`,[x-12,y-12,z],[x+12,y+12,z+8],steel);
 }
 // Fill the gaps between skyline towers with low industrial buildings, rather than isolated boxes.
 for(const axis of['x','y'])for(const side of[-1,1])for(const [i,span]of[[-660,-396],[-180,180],[396,660]].entries()){
  const r=side<0?[-1332,-960]:[960,1332],h=[420,516,456][i];
  const id=`city-infill-${axis}-${side}-${i}`;
  box(id,axis==='x'?[r[0],span[0],-24]:[span[0],r[0],-24],axis==='x'?[r[1],span[1],h]:[span[1],r[1],h],i%2?concrete:brick);material(id,'all',i%2?concrete:brick);
  const edge=side<0?[-960,-952]:[952,960];
  for(const z of[292,364]){
   box(`${id}-window-${z}`,axis==='x'?[edge[0],span[0]+24,z]:[span[0]+24,edge[0],z],axis==='x'?[edge[1],span[1]-24,z+40]:[span[1]-24,edge[1],z+40],steel);
   material(`${id}-window-${z}`,[axis==='x'?(side<0?'+X':'-X'):(side<0?'+Y':'-Y')],'noir/window4');
  }
 }
 for(const [id,x,y,roofId]of[['west',-1112,-288,'city-building-x--1-1-coping'],['east',1112,768,'city-building-x-1-3-coping'],['north',-768,1112,'city-building-y-1-0-coping'],['south',288,-1112,'city-building-y--1-2-coping']]){
  const h=doc.brushes.find(b=>b.id===roofId).max.z;
  model(`stack-${id}`,'decor_misc/factory_chimney_01.ase',[x,y,h+252],.5,0);
  model(`roof-ac-${id}`,'decor_misc/aircondition_01.ase',[x+64,y,h+52],1,0);
 }
 // Natural alignment on the new structural detail, retaining existing single-face overrides.
 for(const o of[...ops])if(o.op==='box.create'&&!o.id.includes('-window-'))material(o.id,'all',o.shader);
}
if(stage==='dressing'){
 // Four service portals turn the opaque support block into a useful lower route.
 for(const b of doc.brushes.filter(b=>b.id.startsWith('reactor-dais')))material(b.id,'all',concrete);
 ops.push({op:'brush.carve',min:v(-64,-192,0),max:v(64,192,144)});
 ops.push({op:'brush.carve',min:v(-192,-64,0),max:v(192,64,144)});
 light('exchange-underlight',[0,0,96],'0.25 0.65 0.44',180);
 // Source facade export splits after carving; every retained piece inherits the material above.
 for(const side of[-1,1]){
  const r=side<0?[-194,-192]:[192,194];
  for(const c of[-128,128]){
   box(`dais-vent-${side}-${c}`,[c-40,r[0],40],[c+40,r[1],104],steel);
   material(`dais-vent-${side}-${c}`,[side<0?'-Y':'+Y'],'hazelh/flat/ventpanel1');
  }
  box(`portal-lintel-${side}`,[-72,r[0]-2,136],[72,r[1]+2,144],'lights/blue1');
 }
 // Utility consoles sit in the deck corners, leaving the cardinal bridges clear.
 for(const x of[-148,148])for(const y of[-148,148]){
  const id=`console-${x}-${y}`;
  box(id,[x-24,y-24,192],[x+24,y+24,212],steel);material(id,'all',steel);material(id,['+Z'],'boqu/fusebox_front');
 }
 model('dumpster-west','city/trash_container_1.ase',[-824,96,53],.6,0);
 model('dumpster-east','city/trash_container_1.ase',[824,-96,53],.6,180);
 box('dumpster-west-clip',[-828,92,0],[-704,174,66],'common/fullclip');
 box('dumpster-east-clip',[704,-174,0],[828,-92,66],'common/fullclip');
 // A restrained broken paving layer, copied from wfdm5's nonsolid tile workflow.
 for(const x of[-240,-144,-48,48,144,240])for(const y of[-552,-456,456,552]){
  const seed=Math.abs(x*7+y*13),dx=(seed%9)-4,dy=(seed%11)-5;
  model(`loose-paver-${x}-${y}`,'wdm5/floor_tile_concrete_1.ase',[x+dx,y+dy,1+(seed%3)*.4],.72+(seed%4)*.04,(seed%13)-6);
 }
 const decal=(id,shader,pos,width,height,angles,alpha=.8)=>entity(id,'misc_decal',pos,{shader:'textures/'+shader,width:String(width),height:String(height),angles,distance:'24',vertexalpha:String(alpha)});
 for(const x of[-432,432])for(const y of[-248,248])decal(`basin-warning-${x}-${y}`,'decals/decal_danger',[x,y,12],64,64,'90 0 0');
 for(const [i,x,y]of[[0,-204,-420],[1,192,420],[2,-744,-168],[3,744,168],[4,84,0],[5,-84,0]])
  decal(`pavement-grime-${i}`,'decals/dirt_01',[x,y,12],176,128,'90 0 0',.5);
 for(const [i,x,y,yaw]of[[0,-440,804,90],[1,440,804,90],[2,-440,-804,-90],[3,440,-804,-90]])
  decal(`wall-tag-${i}`,i%2?'decals/graffitilercho':'decals/graffiti_04_blend',[x,y,112],256,144,`0 ${yaw} 0`,.92);
 const text=(id,words,pos,height,angles,color='0.95 0.82 0.5')=>entity(id,'misc_text_decal',pos,{text:words,font:'textures/decals/fonts/relay_yard',height:String(height),align:'center',valign:'center',tracking:'1',angles,distance:'24',vertexcolor:color,vertexalpha:'0.9'});
 box('yard-nameboard',[-200,808,340],[200,816,382],steel);material('yard-nameboard','all',steel);
 text('yard-name','RELAY YARD  /  07',[0,796,362],22,'0 90 0');
 text('exchange-label','COOLANT EXCHANGE',[0,-206,170],13,'0 90 0');
 for(const [side,x]of[['WEST',-432],['EAST',432]])text(`coolant-stencil-${side}`,'COOLANT',[x,-252,12],16,'90 0 0');
 text('maintenance-bay-label','MAINTENANCE',[-540,792,220],14,'0 90 0','0.55 0.85 1');
 text('loading-bay-label','LOADING BAY',[540,-792,220],14,'0 -90 0','1 0.65 0.26');
}
if(stage==='atmosphere'){
 ops.push({op:'world.keys',keys:{message:'Relay Yard - Coolant Exchange',ambient:'7',_color:'0.44 0.49 0.62',_lightingIntensity:'1.6',fog:'4500 0.025 0.035 0.05 512'}});
 for(const b of doc.brushes.filter(b=>b.id.startsWith('reactor-dais')))material(b.id,'all',concrete);
 for(const b of doc.brushes.filter(b=>/^vent-/.test(b.id))){
  const side=b.min.x<0?-1:1;
  box(`vent-mount-${b.id}`,side<0?[-840,b.min.y,372]:[b.max.x,b.min.y,372],side<0?[b.min.x,b.max.y,b.max.z]:[840,b.max.y,b.max.z],steel);
 }
 for(const side of[-1,1])for(const x of[-720,-480,-240,0,240,480,720])for(const z of[438,474])
  box(`pipe-hanger-${side}-${x}-${z}`,[x-3,side<0?-840:792,z-3],[x+3,side<0?-792:840,z+3],steel);
 for(const x of[-828,828])for(const y of[-624,624])box(`gantry-bearing-${x}-${y}`,[x-8,y-8,384],[x+8,y+8,552],steel);
 for(const o of[...ops])if(o.op==='box.create')material(o.id,'all',o.shader);
}
if(stage==='reactor-finish'){
 const patches=doc.patches.filter(p=>p.id.startsWith('reactor-glass-'));
 ops.push({op:'object.delete',ids:patches.map(p=>p.id)});
 for(const p of patches)ops.push({op:'patch.create',...p,shader:p.id.includes('-brace-')?p.shader:'blxbis/glass_lined',controlPoints:[...p.controlPoints].reverse()});
}
if(stage==='hero'){
 const glass=doc.patches.filter(p=>p.id.startsWith('reactor-glass-'));
 ops.push({op:'object.delete',ids:glass.map(p=>p.id)});
 for(const p of glass){
  ops.push({op:'patch.create',...p,shader:'scifi_interior/blue_glass'});
  ops.push({op:'patch.create',...p,id:p.id.replace('glass','core'),controlPoints:p.controlPoints.map(row=>row.map(c=>({...c,x:c.x*.44,y:c.y*.44})))});
  for(const z of[234,288,342,390])ops.push({op:'patch.create',...p,id:`${p.id}-brace-${z}`,shader:steel,controlPoints:p.controlPoints.map((row,i)=>row.map(c=>({...c,x:c.x*1.035,y:c.y*1.035,z:z+i*2,v:i*.1})))});
 }
 // The central fullclip volume already encloses these decorative fittings.
 for(const x of[-52,48])for(const y of[-52,48]){
  const id=`reactor-coolant-tube-${x}-${y}`;
  box(id,[x,y,224],[x+4,y+4,392],'blxbis/trim4_turq_light_01_150_nonsolid');
  material(id,'all','blxbis/trim4_turq_light_01_150_nonsolid');
  ops.push({op:'box.update',id,detail:true});
 }
}
if(stage==='lighting'){
 ops.push({op:'world.keys',keys:{ambient:'10',_color:'0.6 0.68 0.9',_lightingIntensity:'2.5',_floodlight:'240 255 255 768 30'}});
 for(const e of doc.entities.filter(e=>e.classname==='misc_text_decal'))
  ops.push({op:'entity.update',id:e.id,keys:{distance:'14'}});
 ops.push({op:'entity.update',id:'exchange-label',origin:v(0,-198,169),keys:{height:'11',distance:'8'}});
 for(const e of doc.entities.filter(e=>e.id.startsWith('lamp-pool-')))
  ops.push({op:'entity.update',id:e.id,keys:{light:'240'}});
}
if(stage==='optimize'){
 const structural=/^(shell-|city-sky-|arena-boundary-|reactor-dais|stairs-|gallery-|bridge-|maintenance-deck$|loading-deck$|slime-)/;
 for(const b of doc.brushes)if(!structural.test(b.id)&&!b.shader.startsWith('common/')&&!/slime/i.test(b.shader))
  ops.push({op:'box.update',id:b.id,detail:true});
}
const client=new Client({name:'sol-relay-yard-refinement',version:'2.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['src/games/fps/scripts/shagged-mcp.mjs'],cwd:process.cwd(),stderr:'pipe'});
transport.stderr?.on('data',()=>{});
async function call(name,args){
 const result=await client.callTool({name,arguments:args},undefined,{timeout:1800000});
 const data=JSON.parse(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
 if(result.isError||data.ok===false){fs.writeFileSync(`${output}/refinement/${stage}-failure.json`,JSON.stringify(data,null,2));throw new Error(JSON.stringify(data));}
 return data;
}
try{
 await client.connect(transport);
 const live=await call('shagged_map_info',{mapName});
 if(live.revision!==doc.revision)throw new Error(`Snapshot ${doc.revision} does not match live MCP revision ${live.revision}`);
 if(ops.length){
  fs.writeFileSync(`${output}/refinement/${stage}.ops.json`,JSON.stringify(ops,null,2)+'\n');
  const applied=await call('shagged_apply',{mapName,ops});console.log('APPLIED',applied.created.length,applied.changed.length,applied.issues);
  fs.copyFileSync(`server-data/shagged/agent/${mapName}.json`,`${output}/solamphi1.json`);
 }
 console.log('HEALTH',JSON.stringify(await call('shagged_health',{mapName})));
 const started=Date.now();
 const report=await call(stage==='report'?'shagged_report':'shagged_compile',{mapName,quality:process.env.SOLAMPHI_QUALITY??'fast'});
 report.compileCallMs=Date.now()-started;
 fs.writeFileSync(`${output}/refinement/${stage}-report.json`,JSON.stringify(report,null,2)+'\n');
 console.log('RESULT',JSON.stringify(report));
}finally{await client.close();}
