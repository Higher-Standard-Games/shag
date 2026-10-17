import { Engine } from "@babylonjs/core/Engines/engine";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import "@babylonjs/core/Shaders/color.vertex";
import "@babylonjs/core/Shaders/color.fragment";
import { EditorSession } from "../../src/engine/editor/EditorSession";
import { applyOperations, emptyDocument } from "../../src/engine/editor/api/Operations";
import type { ShaggedApi } from "../../src/engine/editor/ShaggedApi";
import { GamePaths } from "../../src/engine/core/GamePaths";
import { PK3Index } from "../../src/engine/loader/pk3/PK3Index";

/** Static package imports keep the isolated probe on the editor's Babylon module graph. */
export async function runConvexBrowserFixture() {
  await GamePaths.getInstance().init();
  await PK3Index.getInstance().ensureIndex();
  const canvas=document.createElement("canvas");canvas.style.cssText="width:100vw;height:100vh;display:block";document.body.appendChild(canvas);
  const engine=new Engine(canvas,true);
  const api={status:async()=>({saveAvailable:false,compilerAvailable:false,playableAvailable:false,supportedQualities:[],reason:"Isolated QA"})} as unknown as ShaggedApi;
  const session=new EditorSession(engine,canvas,()=>{},api);
  session.root.querySelector<HTMLButtonElement>('[data-view-mode="brush"]')!.click();
  const footprint=Array.from({length:8},(_,i)=>({x:140+48*Math.cos(i*Math.PI/4),y:64+48*Math.sin(i*Math.PI/4)}));
  const doc=applyOperations(emptyDocument("qa_convex_browser"),[
    {op:"box.create",id:"floor",min:{x:-240,y:-200,z:-16},max:{x:240,y:200,z:0},shader:"common/caulk"},
    {op:"box.create",id:"bridge",min:{x:-128,y:-16,z:32},max:{x:128,y:16,z:48},shader:"blx/blx_grid"},
    {op:"brush.rotate",id:"bridge",axis:"z",degrees:45},
    {op:"gen.prism",id:"platform",footprint,bottom:0,top:64,shader:"blx/blx_grid"},
    {op:"convex.create",id:"wedge",vertices:[{x:-180,y:-64,z:0},{x:-84,y:-64,z:0},{x:-84,y:-64,z:64},{x:-180,y:64,z:0},{x:-84,y:64,z:0},{x:-84,y:64,z:64}],sides:[{vertices:[0,1,2]},{vertices:[3,5,4]},{vertices:[0,3,4,1]},{vertices:[1,4,5,2]},{vertices:[0,2,5,3]}],shader:"blx/blx_grid"},
  ]).doc;
  session.document.transact(draft=>Object.assign(draft,doc));
  // Probe the live editor's internal selection/frame state without saving a user draft.
  const live=session as unknown as {selectedId:string;changed:()=>void;frame:(all:boolean)=>void;meshes:Map<string,import("@babylonjs/core/Meshes/mesh").Mesh>};
  live.selectedId="bridge";live.changed();live.frame(true);
  engine.runRenderLoop(()=>session.render());
  (window as unknown as {__convexQA:unknown}).__convexQA={session,engine};
  const mesh=live.meshes.get("bridge")!;mesh.computeWorldMatrix(true);
  return {gpu:engine.getGlInfo(),hulls:doc.brushes.filter(b=>b.hull).length,bridgeVertices:mesh.getTotalVertices(),hit:mesh.intersects(new Ray(new Vector3(50,120,50),new Vector3(0,-1,0)),false).hit,miss:mesh.intersects(new Ray(new Vector3(90,120,-90),new Vector3(0,-1,0)),false).hit,rotationControl:!!session.root.querySelector("[data-rotate-brush]")};
}
