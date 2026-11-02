import {createRT,tuneConvRB,type RT,type ConvTune} from '../../vendor/framegen/rt.js';
import {interpolationTimes} from './presentation';
export type FramegenKind='framegen-live'|'framegen-anime';
export const classifyStats=(mean:number,max:number)=>({duplicate:mean<2.5&&max<45,cut:mean>90});
export const alignedSize=(w:number,h:number)=>{
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>8192||h>1080)throw Error('无效的 Framegen 视频尺寸');
  return [Math.ceil(w/16)*16,Math.ceil(h/16)*16] as const;
};
type Loader=(path:string)=>Promise<ArrayBuffer>;
const pad=`@group(0) @binding(0) var input:texture_2d<f32>;
@group(0) @binding(1) var output:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p:vec3<u32>){
 if(any(p.xy>=textureDimensions(output))){return;}
 textureStore(output,vec2<i32>(p.xy),textureLoad(input,vec2<i32>(min(p.xy,textureDimensions(input)-1u)),0));
}`;
// Framegen's 48x27 RGB-difference classifier and original thresholds.
const classify=`@group(0) @binding(0) var a:texture_2d<f32>;
@group(0) @binding(1) var b:texture_2d<f32>;
@group(0) @binding(2) var smp:sampler;
@group(0) @binding(3) var<storage,read_write> stats:array<atomic<u32>,2>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p:vec3<u32>){
 if(p.x>=48u||p.y>=27u){return;}
 let uv=(vec2<f32>(p.xy)+.5)/vec2<f32>(48.,27.);
 let d=u32(dot(abs(textureSampleLevel(a,smp,uv,0.).rgb-textureSampleLevel(b,smp,uv,0.).rgb),vec3<f32>(255.)));
 atomicAdd(&stats[0],d);atomicMax(&stats[1],d);
}`;
export class FramegenSession {
  device!:GPUDevice;
  private rt?:RT;private inputs:GPUTexture[]=[];private output?:GPUTexture;private cropped?:GPUTexture;
  private padding!:GPUComputePipeline;private classifier!:GPUComputePipeline;private sampler!:GPUSampler;
  private stats?:GPUBuffer;private readback?:GPUBuffer;private pending?:Promise<unknown>;
  private initializing?:Promise<void>;private stopped=false;private ownDevice=false;
  private width=0;private height=0;private w=0;private h=0;private kind:FramegenKind='framegen-live';
  duplicatePairs=0;cutPairs=0;
  constructor(private base:URL){}
  get backend(){return `Framegen v7s · ${this.kind==='framegen-anime'?'动画去重':'真人'} · ${this.width}×${this.height}`;}
  init(kind:FramegenKind,width:number,height:number,device?:GPUDevice,loader?:Loader){
    if(this.initializing)throw Error('禁止重复初始化 Framegen');
    this.initializing=this.start(kind,width,height,device,loader);return this.initializing;
  }
  private async start(kind:FramegenKind,width:number,height:number,device?:GPUDevice,loader?:Loader){
    this.kind=kind;this.width=width;this.height=height;[this.w,this.h]=alignedSize(width,height);
    const load:Loader=loader??(async path=>{const r=await fetch(new URL('models/framegen/'+path,this.base));if(!r.ok)throw Error('缺少 Framegen 文件：'+path);return r.arrayBuffer();});
    const record=JSON.parse(new TextDecoder().decode(await load('manifest.json'))) as {files:Record<string,string>};
    const assets=await Promise.all(['rt_v7s.bin','rt_v7s.json'].map(async name=>{
      const data=await load(name),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
      if(hash!==record.files[name])throw Error('Framegen 文件校验失败：'+name);return data;
    }));
    this.assertLive();
    if(device)this.device=device;else{
      const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
      if(!adapter?.features.has('shader-f16'))throw Error('Framegen 需要支持 shader-f16 的 WebGPU 显卡');
      this.device=await adapter.requestDevice({requiredFeatures:['shader-f16',...(adapter.features.has('timestamp-query')?['timestamp-query' as GPUFeatureName]:[])]});this.ownDevice=true;
    }
    this.assertLive();if(!this.device.features.has('shader-f16'))throw Error('Framegen 需要 shader-f16');
    const d=this.device,manifest=JSON.parse(new TextDecoder().decode(assets[1]));
    // Only tune before playback; cache by adapter, shape and pinned runtime revision.
    let tune:ConvTune|undefined;
    const key='framehaven-fg-9641808-'+JSON.stringify(d.adapterInfo)+'-'+this.w+'x'+this.h;
    try{tune=typeof chrome!=='undefined'&&chrome.storage?.local?(await chrome.storage.local.get(key))[key]:JSON.parse(localStorage.getItem(key)??'null')??undefined;}catch{}
    if(tune&&(![4,8,16,24,32,48,64,96].includes(tune.coc)||!Number.isFinite(tune.slab)))tune=undefined;
    if(!tune){
      tune=await tuneConvRB(d,{ci:96,co:96,w16:this.w/16,h16:this.h/16,s2ci:48});this.assertLive();
      try{if(typeof chrome!=='undefined'&&chrome.storage?.local)await chrome.storage.local.set({[key]:tune});else localStorage.setItem(key,JSON.stringify(tune));}catch{}
    }
    this.rt=await createRT(d,{w:this.w,h:this.h,weightsBin:assets[0],weightsManifest:manifest,convTune:tune,textureInput:true,textureOutput:true,staticGuard:true});this.assertLive();
    const texture=(format:GPUTextureFormat,w=this.w,h=this.h)=>d.createTexture({size:[w,h],format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC|GPUTextureUsage.COPY_DST});
    this.inputs=[texture('rgba16float'),texture('rgba16float')];this.output=texture('rgba8unorm');
    this.cropped=texture('rgba8unorm',width,height);
    this.padding=await d.createComputePipelineAsync({layout:'auto',compute:{module:d.createShaderModule({code:pad}),entryPoint:'main'}});
    this.classifier=await d.createComputePipelineAsync({layout:'auto',compute:{module:d.createShaderModule({code:classify}),entryPoint:'main'}});
    this.sampler=d.createSampler({minFilter:'linear',magFilter:'linear'});
    this.stats=d.createBuffer({size:8,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
    this.readback=d.createBuffer({size:8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});this.assertLive();
  }
  private assertLive(){if(this.stopped)throw Error('Framegen 已关闭');}
  capture(texture:GPUTexture,slot:0|1){
    this.assertLive();if(this.pending)throw Error('禁止覆盖正在推理的输入');
    const d=this.device,e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(this.padding);
    p.setBindGroup(0,d.createBindGroup({layout:this.padding.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.inputs[slot].createView()}]}));
    p.dispatchWorkgroups(this.w/8,this.h/8);p.end();d.queue.submit([e.finish()]);
  }
  async sceneCut(previous:0|1,current:0|1){
    this.assertLive();const d=this.device;d.queue.writeBuffer(this.stats!,0,new Uint32Array(2));
    const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(this.classifier);
    p.setBindGroup(0,d.createBindGroup({layout:this.classifier.getBindGroupLayout(0),entries:[{binding:0,resource:this.inputs[previous].createView()},{binding:1,resource:this.inputs[current].createView()},{binding:2,resource:this.sampler},{binding:3,resource:{buffer:this.stats!}}]}));
    p.dispatchWorkgroups(6,4);p.end();e.copyBufferToBuffer(this.stats!,0,this.readback!,0,8);d.queue.submit([e.finish()]);
    await this.readback!.mapAsync(GPUMapMode.READ);const data=new Uint32Array(this.readback!.getMappedRange());
    const result=classifyStats(data[0]/(48*27),data[1]);this.readback!.unmap();this.assertLive();
    if(result.cut)this.cutPairs++;else if(result.duplicate&&this.kind==='framegen-anime')this.duplicatePairs++;
    return result.cut||(result.duplicate&&this.kind==='framegen-anime');
  }
  async middle(previous:0|1,current:0|1){
    let output!:GPUTexture;await this.generate(previous,current,2,texture=>{output=texture;});return output;
  }
  generate(previous:0|1,current:0|1,factor:2|4,consume:(texture:GPUTexture,t:number)=>void|Promise<void>){
    this.assertLive();if(this.pending)throw Error('禁止堆积 Framegen 推理');
    const work=(async()=>{
      this.rt!.prepPair(this.inputs[previous],this.inputs[current]);
      for(const t of interpolationTimes(factor)){
        this.assertLive();this.rt!.runT(t,this.output!);
        const e=this.device.createCommandEncoder();e.copyTextureToTexture({texture:this.output!},{texture:this.cropped!},[this.width,this.height]);this.device.queue.submit([e.finish()]);
        await this.device.queue.onSubmittedWorkDone();this.assertLive();await consume(this.cropped!,t);
      }
    })();this.pending=work;void work.finally(()=>{this.pending=undefined;}).catch(()=>{});return work;
  }
  async dispose(){
    this.stopped=true;await this.initializing?.catch(()=>{});await this.pending?.catch(()=>{});
    this.rt?.destroy();this.rt=undefined;this.inputs.forEach(t=>t.destroy());this.inputs=[];
    this.output?.destroy();this.cropped?.destroy();this.stats?.destroy();this.readback?.destroy();if(this.ownDevice)this.device?.destroy();
  }
}
