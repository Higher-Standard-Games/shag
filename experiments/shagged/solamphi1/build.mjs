// Run from the repository root: node experiments/shagged/solamphi1/build.mjs [greybox|detail|report]
// All authoring goes through the real stdio MCP server. Existing maps are never replaced.
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const mapName = 'solamphi1';
const output = 'experiments/shagged/solamphi1';
const stage = process.argv[2] ?? 'greybox';
if (!['greybox', 'detail', 'polish', 'access', 'finish', 'machinery', 'city', 'report'].includes(stage)) throw new Error('Use greybox, detail, polish, access, finish, machinery, city or report');
const v = (x, y, z) => ({ x, y, z });
const ops = [];
const box = (id, min, max, shader) => ops.push({ op: 'box.create', id, min: v(...min), max: v(...max), shader });
const entity = (id, classname, origin, keys = {}) => ops.push({ op: 'entity.place', id, classname, origin: v(...origin), keys });
const light = (id, origin, color, power) => entity(id, 'light', origin, { _color: color, light: String(power) });
const material = (id, faces, shader) => ops.push({ op: 'face.material', id, faces, shader });
const steel = 'exwsw/matte_eX_surf_metaldarkgrey';
const wall = 'concrete/concretebunker0068';
const floor = 'tiles/concrete_tiles';
const neon = ['lights/blue1', 'jewels/neon_red', 'baxandall/neon_07', 'neon/neon_square'];

if (stage === 'greybox') {
  ops.push({ op: 'gen.room', id: 'shell', min: v(-1120, -1120, 0), max: v(1120, 1120, 768),
    wall: 32, shader: wall, floorShader: floor, ceilingShader: steel, light: false });
  // Two continuous elevations and four cardinal bridges. All dimensions are Quake units.
  box('gallery-north', [-1120, 832, 232], [1120, 1120, 256], steel);
  box('gallery-south', [-1120, -1120, 232], [1120, -832, 256], steel);
  box('gallery-east', [832, -832, 232], [1120, 832, 256], steel);
  box('gallery-west', [-1120, -832, 232], [-832, 832, 256], steel);
  box('reactor-dais', [-256, -256, 0], [256, 256, 256], steel);
  box('bridge-north', [-96, 256, 232], [96, 832, 256], steel);
  box('bridge-south', [-96, -832, 232], [96, -256, 256], steel);
  box('bridge-east', [256, -96, 232], [832, 96, 256], steel);
  box('bridge-west', [-832, -96, 232], [-256, 96, 256], steel);
  for (const x of [-576, 576]) for (const sign of [-1, 1]) {
    const id = `stairs-${x}-${sign}`;
    ops.push({ op: 'gen.stairs', id, from: v(x, sign * 320, 0), to: v(x, sign * 832, 256),
      width: 192, step: 16, shader: steel });
  }
  // Spawn alcove partitions block direct diagonals without creating closed rooms.
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const a = x < 0 ? [-960, -800] : [800, 960];
    const b = y < 0 ? [-608, -576] : [576, 608];
    box(`spawn-baffle-${x}-${y}`, [a[0], b[0], 0], [a[1], b[1], 144], wall);
    entity(`spawn-${x}-${y}`, 'info_player_deathmatch', [x * 992, y * 704, 32],
      { angle: String(Math.atan2(-y, -x) * 180 / Math.PI) });
  }
  entity('armor-upper', 'item_armor_ya', [0, 640, 280]);
  entity('health-lower', 'item_health_mega', [0, -640, 24]);
  for (const x of [-1, 1]) entity(`health-${x}`, 'item_health', [x * 688, 0, 24]);
  for (const x of [-768, 0, 768]) for (const y of [-768, 0, 768])
    light(`fill-${x}-${y}`, [x, y, 620], '0.62 0.70 1', 1500);
  for (const x of [-928, 928]) for (const y of [-640, 640])
    light(`under-gallery-${x}-${y}`, [x, y, 144], '0.8 0.65 0.5', 450);
}

if (stage === 'detail') {
  const trim = [];
  const trimBox = (...args) => { box(...args); trim.push(args[0]); };
  // Warehouse wall bays: masonry below, concrete panels, steel uprights and neon landmarks.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const c = -960 + i * 320;
      for (const axis of ['x', 'y']) {
        const id = `bay-${axis}-${side}-${i}`;
        const ranges = side < 0 ? [-1120, -1104] : [1104, 1120];
        const min = axis === 'x' ? [ranges[0], c - 136, 16] : [c - 136, ranges[0], 16];
        const max = axis === 'x' ? [ranges[1], c + 136, 216] : [c + 136, ranges[1], 216];
        box(`${id}-brick`, min, max, 'bricks/redbricks_base_01');
        const pmin = axis === 'x' ? [ranges[0], c - 8, 256] : [c - 8, ranges[0], 256];
        const pmax = axis === 'x' ? [ranges[1], c + 8, 736] : [c + 8, ranges[1], 736];
        trimBox(`${id}-upright`, pmin, pmax, steel);
        const nmin = axis === 'x' ? [ranges[0], c - 88, 476] : [c - 88, ranges[0], 476];
        const nmax = axis === 'x' ? [ranges[1], c + 88, 484] : [c + 88, ranges[1], 484];
        box(`${id}-light`, nmin, nmax, neon[(i + (side > 0 ? 1 : 0)) % neon.length]);
        const pos = axis === 'x' ? [side * 1064, c, 440] : [c, side * 1064, 440];
        light(`${id}-glow`, pos, side < 0 ? '0.15 0.6 1' : '1 0.2 0.48', 180);
      }
    }
  }
  // Gallery fascia and supporting columns leave broad, readable underpasses.
  for (const side of [-1, 1]) for (const axis of ['x', 'y']) {
    const near = side < 0 ? [-848, -832] : [832, 848];
    const min = axis === 'x' ? [near[0], -816, 208] : [-1120, near[0], 208];
    const max = axis === 'x' ? [near[1], 816, 232] : [1120, near[1], 232];
    trimBox(`fascia-${axis}-${side}`, min, max, 'metal/metalrust_iron6');
    for (const c of [-704, 704]) {
      const pmin = axis === 'x' ? [side * 944 - 20, c - 20, 0] : [c - 20, side * 944 - 20, 0];
      const pmax = axis === 'x' ? [side * 944 + 20, c + 20, 232] : [c + 20, side * 944 + 20, 232];
      trimBox(`support-${axis}-${side}-${c}`, pmin, pmax, steel);
    }
    // Rail segments leave the cardinal bridge openings clear.
    for (const [lo, hi] of (axis === 'x' ? [[-800, -112], [112, 800]] : [[-800, -688], [-464, -112], [112, 464], [688, 800]])) {
      const rmin = axis === 'x' ? [near[0], lo, 304] : [lo, near[0], 304];
      const rmax = axis === 'x' ? [near[1], hi, 312] : [hi, near[1], 312];
      trimBox(`rail-${axis}-${side}-${lo}`, rmin, rmax, 'metal/metalrust_iron6');
      for (let c = lo; c <= hi; c += 172) {
        const qmin = axis === 'x' ? [near[0], c, 256] : [c, near[0], 256];
        const qmax = axis === 'x' ? [near[1], c + 8, 304] : [c + 8, near[1], 304];
        trimBox(`post-${axis}-${side}-${c}`, qmin, qmax, steel);
      }
    }
  }
  // The reactor uses four joined quadratic quarter-cylinder patches; one simple brush clips it.
  box('reactor-clip', [-80, -80, 256], [80, 80, 560], 'common/fullclip');
  for (let q = 0; q < 4; q++) {
    const a = q * Math.PI / 2, b = a + Math.PI / 2, radius = 104;
    const profile = [[Math.cos(a), Math.sin(a)], [Math.cos(a) + Math.cos(b), Math.sin(a) + Math.sin(b)], [Math.cos(b), Math.sin(b)]];
    const controls = [288, 408, 528].map((z, row) => profile.map(([x, y], col) =>
      ({ x: Math.round(x * radius), y: Math.round(y * radius), z, u: (q * 2 + col) / 8, v: row / 2 })));
    ops.push({ op: 'patch.create', id: `reactor-glass-${q}`, shader: 'lights/blue1', width: 3, height: 3, controlPoints: controls });
  }
  for (const z of [256, 528]) {
    trimBox(`reactor-collar-${z}`, [-128, -128, z], [128, 128, z + 32], steel);
    for (const side of [-1, 1]) {
      box(`reactor-band-${z}-${side}`, [-112, side < 0 ? -132 : 128, z + 12], [112, side < 0 ? -128 : 132, z + 20], 'lights/blue1');
    }
  }
  for (const x of [-120, 112]) for (const y of [-120, 112])
    trimBox(`reactor-strut-${x}-${y}`, [x, y, 288], [x + 8, y + 8, 528], steel);
  light('reactor-cyan', [0, 0, 600], '0.08 1 0.85', 1000);
  for (const x of [-208, 208]) for (const y of [-208, 208])
    light(`reactor-base-${x}-${y}`, [x, y, 300], '0.1 0.8 1', 200);
  // Ceiling ribs break the large concrete volume into industrial bays.
  for (const y of [-832, -416, 0, 416, 832])
    trimBox(`ceiling-rib-${y}`, [-1120, y - 12, 720], [1120, y + 12, 752], steel);
  ops.push({ op: 'brushEntity.assign', id: 'chamfered-trim', classname: 'func_group', brushIds: trim,
    keys: { chamfer_concavewidth: '5', chamfer_convexwidth: '2.2' } });
}

if (stage === 'polish') {
  ops.push({ op: 'box.update', id: 'reactor-clip', shader: 'common/fullclip' });
  // Coloured service doors and inset frames, deliberately outside the running lanes.
  for (const side of [-1, 1]) for (const axis of ['x', 'y']) {
    const id = `service-${axis}-${side}`;
    const r = side < 0 ? [-1104, -1088] : [1088, 1104];
    const min = axis === 'x' ? [r[0], -112, 256] : [-112, r[0], 256];
    const max = axis === 'x' ? [r[1], 112, 440] : [112, r[1], 440];
    box(`${id}-door`, min, max, steel);
    for (const c of [-120, 112]) {
      box(`${id}-jamb-${c}`, axis === 'x' ? [r[0], c, 256] : [c, r[0], 256],
        axis === 'x' ? [r[1], c + 8, 448] : [c + 8, r[1], 448], neon[axis === 'x' ? 0 : 1]);
    }
    box(`${id}-lintel`, axis === 'x' ? [r[0], -112, 440] : [-112, r[0], 440],
      axis === 'x' ? [r[1], 112, 448] : [112, r[1], 448], neon[axis === 'x' ? 0 : 1]);
  }
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    for (let i = 0; i < 3; i++) entity(`barrel-${x}-${y}-${i}`, 'misc_model', [x * (1024 - i * 64), y * 1024, 256],
      { model: 'models/mapobjects/industrial/barrel_2.obj', collisiontype: 'none', spawnflags: '12', angle: String(i * 33), modelscale: '1' });
    entity(`crate-${x}-${y}`, 'misc_model', [x * 1000, y * 940, 256],
      { model: 'models/mapobjects/industrial/crate_color.obj', collisiontype: 'none', spawnflags: '12', angle: String(x * y * 15), modelscale: '1' });
    // Simple collision proxies do not inherit model triangles or visual smoothing.
    box(`crate-clip-${x}-${y}`, [x * 1000 - 40, y * 940 - 40, 256], [x * 1000 + 40, y * 940 + 40, 320], 'common/fullclip');
  }
  box('nats-sign', [-1118, 448, 368], [-1100, 704, 496], steel);
  material('nats-sign', ['+X'], 'noir/natsbar');
  light('nats-sign-glow', [-1024, 576, 408], '1 0.08 0.42', 240);
}

if (stage === 'access') {
  // Repair the first detail revision: railings must leave openings at the stair landings.
  for (const side of [-1, 1]) {
    const ids = [`rail-y-${side}--800`, `rail-y-${side}-112`];
    for (const c of [-800, -628, -456, -284, -112, 112, 284, 456, 628, 800]) ids.push(`post-y-${side}-${c}`);
    ops.push({ op: 'object.delete', ids });
    const r = side < 0 ? [-848, -832] : [832, 848];
    for (const [lo, hi] of [[-800, -688], [-464, -112], [112, 464], [688, 800]]) {
      box(`open-rail-${side}-${lo}`, [lo, r[0], 304], [hi, r[1], 312], steel);
      for (const c of [lo, hi - 8]) box(`open-post-${side}-${lo}-${c}`, [c, r[0], 256], [c + 8, r[1], 304], steel);
    }
  }
}

if (stage === 'finish') {
  for (const x of [-768, 0, 768]) for (const y of [-768, 0, 768])
    ops.push({op:'entity.update',id:`fill-${x}-${y}`,keys:{light:'550',_color:'0.45 0.55 0.72'}});
  for (const side of [-1,1]) for (const cy of [-736, -352, 352, 736]) {
    const rows=[48,128,208].map((z,row)=>[-144,0,144].map((dy,col)=>({x:side*1098,y:cy+dy,z,u:col/2,v:1-row/2})));
    if(side>0) rows.reverse();
    ops.push({op:'patch.create',id:`graffiti-${side}-${cy}`,shader:cy<0?'decals/graffiti_01':'decals/graffiti_02',width:3,height:3,controlPoints:rows});
  }
  for(const side of [-1,1]) for(const [lo,hi]of[[-800,-688],[-464,-112],[112,464],[688,800]])
    box(`hazard-${side}-${lo}`,[lo,side<0?-864:848,256],[hi,side<0?-848:864,258],'refly_trims/36hazard');
}

if (stage === 'city') {
  ops.push({op:'object.delete',ids:['shell-ceiling','ceiling-rib--416','ceiling-rib-0','ceiling-rib-416']});
  for(const [id,max]of[['shell-west',[-1120,1152,512]],['shell-east',[1152,1152,512]],['shell-north',[1120,1152,512]],['shell-south',[1120,-1120,512]]])
    ops.push({op:'box.update',id,max:v(...max)});
  ops.push({op:'gen.room',id:'city-sky',min:v(-2048,-2048,-64),max:v(2048,2048,1792),wall:32,
    shader:'sky/stars',floorShader:'common/caulk',ceilingShader:'sky/stars',light:false});
  for(const axis of['x','y'])for(const side of[-1,1]) {
    const near=side<0?[-1136,-1120]:[1120,1136];
    box(`arena-boundary-${axis}-${side}`,axis==='x'?[near[0],-1120,512]:[-1136,near[0],512],
      axis==='x'?[near[1],1120,1792]:[1136,near[1],1792],'common/playerclip');
    for(const [i,c]of[-1024,-384,384,1024].entries()) {
      const id=`city-building-${axis}-${side}-${i}`;
      const near=side<0?[-1776,-1280]:[1280,1776];
      const h=[720,1056,864,1280][(i+(side>0?1:0)+(axis==='x'?1:0))%4];
      const min=axis==='x'?[near[0],c-144,-32]:[c-144,near[0],-32];
      const max=axis==='x'?[near[1],c+144,h]:[c+144,near[1],h];
      box(id,min,max,i%2?'bricks/redbricks_base_01':wall);material(id,'all',i%2?'bricks/redbricks_base_01':wall);
      const facing=axis==='x'?(side<0?'+X':'-X'):(side<0?'+Y':'-Y');
      for(let z=560;z<h-80;z+=160) {
        const edge=side<0?[-1280,-1276]:[1276,1280];
        const wmin=axis==='x'?[edge[0],c-104,z]:[c-104,edge[0],z];
        const wmax=axis==='x'?[edge[1],c+104,z+64]:[c+104,edge[1],z+64];
        box(`${id}-windows-${z}`,wmin,wmax,steel);material(`${id}-windows-${z}`,[facing],'noir/window4');
      }
      const roofMin=axis==='x'?[near[0],c-152,h]:[c-152,near[0],h];
      const roofMax=axis==='x'?[near[1],c+152,h+16]:[c+152,near[1],h+16];
      box(`${id}-coping`,roofMin,roofMax,steel);material(`${id}-coping`,'all',steel);
    }
  }
  light('sky-cool-fill',[0,0,1400],'0.25 0.35 0.65',1000);
}

if (stage === 'machinery') {
  // Offset fighting pockets break the rotational symmetry without cutting the circulation loop.
  box('maintenance-deck',[-832,96,232],[-352,320,256],steel);
  box('loading-deck',[320,-320,232],[832,-96,256],steel);
  box('maintenance-canopy',[-832,96,448],[-352,320,464],steel);
  for(const x of[-812,-372])box(`maintenance-pillar-${x}`,[x,288,256],[x+16,304,448],steel);
  box('maintenance-screen',[-720,112,256],[-688,272,384],wall);
  box('north-bulkhead',[240,400,0],[272,704,176],wall);
  box('loading-cover',[-768,-192,0],[-512,-160,96],'bricks/redbricks_base_01');
  box('loading-deck-screen',[544,-304,256],[576,-128,384],steel);
  box('canopy-neon',[-800,108,440],[-384,116,448],'lights/blue1');
  light('maintenance-fill',[-592,208,416],'0.12 0.75 1',300);
  light('loading-fill',[656,-208,424],'1 0.35 0.08',240);
  for(const [id,pos,angle] of [['west',[-1096,-96,144],90],['east',[1096,448,144],-90]])
    entity(`electric-box-${id}`,'misc_model',pos,{model:'models/mapobjects/industrial/electricbox_wires.obj',collisiontype:'none',spawnflags:'4',angle:String(angle)});
  for(const [id,pos,angle] of [['maintenance',[-592,312,416],0],['loading',[656,-304,400],180]])
    entity(`cable-${id}`,'misc_model',pos,{model:'models/mapobjects/cables/cables_2b.obj',collisiontype:'none',modelscale:'0.8',angle:String(angle),samplesize:'8',smooth:'1'});
  // Elevated service pipes and vent banks add detail above head height.
  for (const side of [-1,1]) for (const z of [584,632]) for (let q=0;q<4;q++) {
    const a=q*Math.PI/2,b=a+Math.PI/2;
    const profile=[[Math.cos(a),Math.sin(a)],[Math.cos(a)+Math.cos(b),Math.sin(a)+Math.sin(b)],[Math.cos(b),Math.sin(b)]];
    const controlPoints=[-1100,0,1100].map((x,row)=>profile.map(([y,dz],col)=>
      ({x,y:side*1056+y*12,z:z+dz*12,u:row*4,v:(q*2+col)/8})));
    ops.push({op:'patch.create',id:`service-pipe-${side}-${z}-${q}`,shader:'metal/metalrust_iron6',width:3,height:3,controlPoints});
  }
  for(const side of [-1,1]) for(const cy of [-704,704]) {
    const range=side<0?[-1100,-1040]:[1040,1100];
    box(`vent-${side}-${cy}`,[range[0],cy-112,528],[range[1],cy+112,672],steel);
    material(`vent-${side}-${cy}`,[side<0?'+X':'-X'],'hazelh/flat/ventpanel1');
  }
  for(const side of [-1,1]) for(const cy of [-320,320]) {
    const range=side<0?[-1100,-1020]:[1020,1100];
    box(`cabinet-${side}-${cy}`,[range[0],cy-64,0],[range[1],cy+64,160],steel);
    for(const z of[24,64,104]) {
      const r=side<0?[-1020,-1016]:[1016,1020];
      box(`cabinet-slot-${side}-${cy}-${z}`,[r[0],cy-48,z],[r[1],cy+48,z+4],'metal/metalrust_iron6');
    }
  }
  // Raised reactor plinth lights and deck paneling keep the central landmark readable.
  for(const y of[-248,240]) box(`dais-light-${y}`,[-208,y,244],[208,y+8,252],'lights/blue1');
  for(const id of['bridge-north','bridge-south','bridge-east','bridge-west','gallery-north','gallery-south','gallery-east','gallery-west'])
    material(id,['+Z'],'exwsw/eXmetalFloor02');
  for(const op of [...ops]) if(op.op==='box.create'&&!op.shader.startsWith('common/')) material(op.id,'all',op.shader);
  // Restore vent front overrides after assigning natural alignment to their backing boxes.
  for(const side of[-1,1]) for(const cy of[-704,704])material(`vent-${side}-${cy}`,[side<0?'+X':'-X'],'hazelh/flat/ventpanel1');
}

const client = new Client({ name: 'sol-amphi-experiment', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/shagged-mcp.mjs'], cwd: process.cwd(), stderr: 'pipe' });
transport.stderr?.on('data', () => {});
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 1200000 });
  const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const parsed = JSON.parse(text);
  if (result.isError || parsed.ok === false) {
    fs.writeFileSync(`${output}/${stage}-failure.json`, JSON.stringify(parsed, null, 2) + '\n');
    throw new Error(`${name}: ${text}`);
  }
  return parsed;
}
try {
  await client.connect(transport);
  if (stage === 'greybox') await call('shagged_new_map', { mapName });
  if (stage === 'finish') {
    const info=await call('shagged_map_info',{mapName,objects:true});
    for(const b of info.brushes) if(!b.shader.startsWith('common/') && b.id!=='nats-sign')
      material(b.id,'all',b.shader);
  }
  if (ops.length) {
    fs.writeFileSync(`${output}/${stage}.ops.json`, JSON.stringify(ops, null, 2) + '\n');
    const edit = await call('shagged_apply', { mapName, ops });
    console.log('APPLIED', edit.created.length, 'objects;', edit.issues);
    fs.copyFileSync(`server-data/shagged/agent/${mapName}.json`, `${output}/${mapName}.json`);
  }
  console.log('HEALTH', JSON.stringify(await call('shagged_health', { mapName })));
  const result = await call(stage === 'report' ? 'shagged_report' : 'shagged_compile', { mapName, quality: process.env.SOLAMPHI_QUALITY ?? 'fast' });
  fs.writeFileSync(`${output}/${stage}-report.json`, JSON.stringify(result, null, 2) + '\n');
  console.log('RESULT', JSON.stringify(result));
} finally { await client.close(); }
