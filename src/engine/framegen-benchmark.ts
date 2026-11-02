import {FramegenSession} from './framegen';
import {GpuEngine} from './gpu';
import {preset} from '../core/config';
/** Synthetic full-resolution combined pipeline; excludes video/audio and display scheduling. */
export async function benchmarkFramegen(base:URL,progress:(s:string)=>void,options:{device?:GPUDevice;load?:(name:string)=>Promise<ArrayBuffer>;canvas?:()=>HTMLCanvasElement}={}){
  const results=[];
  for(const [mode,factor] of [['live',2],['live',4],['anime',2],['anime',4]] as const){
    const model=new FramegenSession(base),config=preset(mode);config.interpolationFactor=factor;let engine:GpuEngine|undefined;
    const textures:GPUTexture[]=[],errors:string[]=[];let uniform:GPUBuffer|undefined;
    try{
      progress(`正在初始化 ${mode==='live'?'真人':'动画'} ${factor}× 1080p 全增强测试…`);
      await model.init('framegen-'+mode as 'framegen-live'|'framegen-anime',1920,1080,options.device,options.load);
      const d=model.device;const onError=(e:GPUUncapturedErrorEvent)=>errors.push(e.error.message);d.addEventListener('uncapturederror',onError);
      const canvas=options.canvas?.()??document.createElement('canvas');engine=new GpuEngine(canvas);await engine.init(config,d);engine.onLost=s=>errors.push(s);
      const source=d.createTexture({size:[1920,1080],format:'rgba16float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC});textures.push(source);
      uniform=d.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      const module=d.createShaderModule({code:`
@group(0) @binding(0) var image:texture_storage_2d<rgba16float,write>;
@group(0) @binding(1) var<uniform> offset:vec4<u32>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) p:vec3<u32>){
 if(p.x>=1920u||p.y>=1080u){return;}
 let uv=vec2<f32>(p.xy)/vec2<f32>(1920.,1080.);
 let stripe=select(.1,.4,((p.x+offset.x)/32u+p.y/32u)%2u==0u);
 textureStore(image,vec2<i32>(p.xy),vec4<f32>(uv.x*.4+stripe,uv.y*.4+stripe,.2+stripe,1.));
}`});
      const pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
      const group=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:{buffer:uniform}}]});
      const fill=(shift:number)=>{d.queue.writeBuffer(uniform!,0,new Uint32Array([shift,0,0,0]));const e=d.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(pipeline);p.setBindGroup(0,group);p.dispatchWorkgroups(240,135);p.end();d.queue.submit([e.finish()]);};
      fill(0);engine.renderTexture(source,config);const previous=engine.preprocessedSnapshot(),baseline=engine.original();
      try{
        fill(8);
        const run=async()=>{
          engine!.renderTexture(source,config);const original=engine!.snapshot();
          model.capture(previous,0);model.capture(engine!.preprocessedInput,1);
          if(await model.sceneCut(0,1))throw Error('测试运动帧被错误跳过');
          await model.generate(0,1,factor,async(mid)=>{engine!.renderInterpolated(mid,config,baseline);const generated=engine!.snapshot();await engine!.completed();engine!.releaseSnapshot(generated);});
          engine!.releaseSnapshot(original);
        };
        for(let i=0;i<5;i++)await run();progress(`正在测量 ${mode==='live'?'真人':'动画'}：${factor}× 全部增强、1080p 补帧、4K 输出…`);
        const samples=[];for(let i=0;i<30;i++){const start=performance.now();await run();samples.push(performance.now()-start);}
        if(errors.length)throw Error(errors.join('\n'));const sorted=[...samples].sort((a,b)=>a-b);
        const counts=engine.completedStages;if(counts.deblock!==36||counts.sharpen!==36+35*(factor-1)||counts.upscale!==counts.sharpen)throw Error('GPU 完成计数不符合实际调用');
        results.push({mode,factor,completedStages:{...counts},input:[1920,1080],output:[canvas.width,canvas.height],medianMs:sorted[15],p95Ms:sorted[28],meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,samplesMs:samples,errors});
      }finally{engine.releaseSnapshot(previous);engine.releaseSnapshot(baseline);}
      d.removeEventListener('uncapturederror',onError);
    }finally{engine?.dispose();textures.forEach(t=>t.destroy());uniform?.destroy();await model.dispose();}
  }
  return {scope:'Synthetic 1080p texture → all original spatial enhancements → Framegen midpoint → original sharpen/upscale → 2 or 4 final 4K output snapshots per pair. Excludes video decode/import, display cadence and audio synchronization.',version:'1.0.0',results};
}
