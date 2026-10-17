import fs from 'node:fs';
import { bootGame, openBrowser, sleep } from '../../../.claude/skills/browser-probe/scripts/cdp.mjs';
const b = await openBrowser({width:1600,height:1000});
try {
  await bootGame(b,'http://127.0.0.1:3100/?renderer=webgl2');
  console.log('LOAD',await b.ev(`(async()=>{
    const {MapLoader}=await import('/src/engine/loader/map/MapLoader.ts');
    const result=await MapLoader.getInstance().loadMap('solamphi1',window.scene);
    return {success:result.success,error:result.error};
  })()`));
  await sleep(5000);
  await b.ev(`(async()=>{
    const {FreeCamera}=await import('/node_modules/@babylonjs/core/Cameras/freeCamera.js');
    const {q3ToBabylonVec3:q}=await import('/src/engine/loader/bsp/mesh/coordinates.ts');
    const s=window.scene;
    const c=new FreeCamera('solamphi-review',q([700,-740,750]),s);
    c.setTarget(q([0,60,135])); c.fov=1.35;
    window.solReview={c,q};
    s.onBeforeRenderObservable.add(()=>{s.activeCameras=null;s.activeCamera=c;});
    document.querySelectorAll('body *').forEach(el=>el.style.visibility='hidden');
    document.querySelector('canvas').style.visibility='visible';
  })()`);
  await sleep(2500);
  await b.shot('.cache/solamphi-overview.png');
  await b.ev(`{const {c,q}=window.solReview;c.position.copyFrom(q([-700,-440,250]));c.setTarget(q([0,0,280]));c.fov=1.4;}`);
  await sleep(1500);await b.shot('.cache/solamphi-gallery.png');
  await b.ev(`{const {c,q}=window.solReview;c.position.copyFrom(q([300,-480,56]));c.setTarget(q([0,0,120]));c.fov=1.4;}`);
  await sleep(1500);await b.shot('.cache/solamphi-ground.png');
  await b.ev(`{const {c,q}=window.solReview;c.position.copyFrom(q([684,-624,90]));c.setTarget(q([320,-380,-10]));c.fov=1.25;}`);
  await sleep(1500);await b.shot('.cache/solamphi-slime.png');
  const stats=await b.ev(`({fps:window.scene.getEngine().getFps(),meshes:window.scene.meshes.length,activeMeshes:window.scene.getActiveMeshes().length,faces:window.scene.getActiveIndices()/3})`);
  fs.writeFileSync('.cache/solamphi-visual-report.json',JSON.stringify({backend:'webgl2',headless:true,stats,logs:b.logs,failed:b.failed},null,2));
  console.log('STATS',stats,'ERRORS',b.logs.filter(l=>/EXCEPTION|error/i.test(l)&&!/LobbyClient|lobby server/i.test(l)).slice(-12),'HTTP',b.failed.slice(-8));
} finally {await b.close();}

process.exit(0);
