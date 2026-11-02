import {animeRestore,animeUpscale} from '../generated/anime';
import {fsrcnnx} from '../generated/fsrcnnx';
import {ingest,cas,present} from './shaders';
import {SpatialCompute} from './spatial';
import {SnapshotPool} from './snapshot-pool';
import {deblock,deband} from './filters';
import {capabilities,type Config,type Stage} from '../core/config';
type ModelPass=typeof animeRestore[number];
interface Pass {pipeline:GPURenderPipeline;spec:ModelPass}
export class GpuEngine {
  private submitted:Partial<Record<Stage,number>>={};
  readonly completedStages:Partial<Record<Stage,number>>={};
  private count(stage:Stage){this.submitted[stage]=(this.submitted[stage]??0)+1;}
  private device!:GPUDevice;
  private spatial?:SpatialCompute;
  private context!:GPUCanvasContext;
  private sampler!:GPUSampler;
  private inputPipeline!:GPURenderPipeline;
  private casPipeline!:GPURenderPipeline;
  private outputPipeline!:GPURenderPipeline;
  private deblockPipeline!:GPURenderPipeline;private debandPipeline!:GPURenderPipeline;
  private restore:Pass[]=[];private upscale:Pass[]=[];
  private fsrcnnxPasses:Pass[]=[];private fsrcnnxTargets:GPUTexture[]=[];
  private buffers:GPUBuffer[]=[];
  private textures:GPUTexture[]=[];
  private source!:GPUTexture;private casTarget!:GPUTexture;
  private restoreTargets:GPUTexture[]=[];private upscaleTargets:GPUTexture[]=[];
  private filterTargets:GPUTexture[]=[];
  private filterBuffers:GPUBuffer[]=[];
  private width=0;private height=0;private stopped=false;
  private configured=false;private ownsDevice=true;
  private prepared?:GPUTexture;
  private snapshots?:SnapshotPool;
  get gpuDevice(){return this.device;}
  get preprocessedInput(){if(!this.prepared)throw Error('尚无输入帧');return this.prepared;}
  onLost:(message:string)=>void=()=>{};
  constructor(readonly canvas:HTMLCanvasElement){}
  async init(config?:Config,sharedDevice?:GPUDevice){
    const active=config?capabilities(config).active:undefined;
    const enabled=(stage:Stage,algorithm?:string)=>!config||!!active?.includes(stage)&&(!algorithm||config.stages[stage].algorithm===algorithm);
    if(!navigator.gpu)throw Error('此页面无法使用 WebGPU，请检查 Edge 硬件加速或使用 HTTPS 页面');
    if(sharedDevice){this.device=sharedDevice;this.ownsDevice=false;}else{
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
      if(!adapter)throw Error('未找到可用的 GPU 设备');
      this.device=await adapter.requestDevice();
    }
    if(this.stopped){if(this.ownsDevice)this.device.destroy();throw Error('初始化已取消');}
    this.snapshots=new SnapshotPool(this.device);
    this.device.lost.then(info=>{if(!this.stopped)this.onLost(`GPU 设备已断开：${info.message}`);});
    this.device.addEventListener('uncapturederror',event=>this.onLost(`GPU 处理失败：${event.error.message}`));
    this.context=this.canvas.getContext('webgpu')!;
    if(!this.context)throw Error('无法创建 GPU 画布');
    this.context.configure({device:this.device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque',colorSpace:'srgb',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    this.configured=true;
    this.sampler=this.device.createSampler({minFilter:'linear',magFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
    this.inputPipeline=await this.pipeline(ingest,'rgba16float');
    this.assertLive();
    if(enabled('sharpen','sharpen-cas'))this.casPipeline=await this.pipeline(cas,'rgba16float');
    this.assertLive();
    this.outputPipeline=await this.pipeline(present,navigator.gpu.getPreferredCanvasFormat());
    this.assertLive();
    if(enabled('deblock'))this.deblockPipeline=await this.pipeline(deblock,'rgba16float');this.assertLive();
    if(enabled('deband'))this.debandPipeline=await this.pipeline(deband,'rgba16float');this.assertLive();
    if(enabled('sharpen','restore-anime4k-s'))for(const spec of animeRestore){const pipeline=await this.pipeline(spec.code,'rgba16float');this.assertLive();this.restore.push({spec,pipeline});}
    if(enabled('upscale','upscale-anime4k-x2-s'))for(const spec of animeUpscale){const pipeline=await this.pipeline(spec.code,'rgba16float');this.assertLive();this.upscale.push({spec,pipeline});}
    if(enabled('upscale','upscale-fsrcnnx-x2'))for(const spec of fsrcnnx){const pipeline=await this.pipeline(spec.code,'rgba16float',true);this.assertLive();this.fsrcnnxPasses.push({spec,pipeline});}
    this.spatial=new SpatialCompute(this.device);
    await this.spatial.init(enabled('denoise'),enabled('dering'));this.assertLive();
    for(let i=0;i<3;i++)this.buffers.push(this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
    for(let i=0;i<3;i++)this.filterBuffers.push(this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
    if(this.stopped)throw Error('初始化已取消');
  }
  private async pipeline(code:string,format:GPUTextureFormat,fsrcnnxLayout=false){
    const module=this.device.createShaderModule({code});
    const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length)throw Error(errors.map(e=>`${e.lineNum}: ${e.message}`).join('\n'));
    const specs:GPUBindGroupLayoutEntry[]=fsrcnnxLayout?[
      ...Array.from({length:4},(_,binding)=>({binding,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float' as GPUTextureSampleType}})),
      {binding:4,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}}
    ]:code===deblock||code===deband?[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
    ]:code===ingest?[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,externalTexture:{}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}}
    ]:code===cas?[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
    ]:[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
      {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
      {binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
      {binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
    ];
    const layout=this.device.createPipelineLayout({bindGroupLayouts:[this.device.createBindGroupLayout({entries:specs})]});
    return this.device.createRenderPipelineAsync({layout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
  }
  private texture(w:number,h:number,extraUsage=0){
    const t=this.device.createTexture({size:[w,h],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC|GPUTextureUsage.STORAGE_BINDING|extraUsage});
    this.textures.push(t);return t;
  }
  private allocationKey='';
  private assertLive(){if(this.stopped)throw Error('GPU 初始化已取消');}
  private resize(w:number,h:number,config:Config){
    const active=capabilities(config).active;
    const useRestore=active.includes('sharpen')&&config.stages.sharpen.algorithm==='restore-anime4k-s';
    const useCas=active.includes('sharpen')&&config.stages.sharpen.algorithm==='sharpen-cas';
    const useUpscale=active.includes('upscale');
    const useFsrcnnx=useUpscale&&config.stages.upscale.algorithm==='upscale-fsrcnnx-x2';
    const key=JSON.stringify([w,h,useRestore,useCas,useUpscale,useFsrcnnx,active.includes('deblock'),active.includes('deband'),active.includes('dering'),active.includes('denoise')]);
    if(key===this.allocationKey)return;
    const limit=this.device.limits.maxTextureDimension2D;
    const scale=useUpscale?2:1;
    if(w*scale>limit||h*scale>limit)throw Error('视频尺寸超过 GPU 纹理上限');
    this.textures.forEach(t=>t.destroy());this.textures=[];
    this.width=w;this.height=h;this.source=this.texture(w,h,GPUTextureUsage.COPY_DST);
    if(useCas)this.casTarget=this.texture(w*scale,h*scale);
    this.restoreTargets=useRestore?this.restore.map(()=>this.texture(w,h)):[];
    this.upscaleTargets=useUpscale&&!useFsrcnnx?this.upscale.map(p=>this.texture(w*p.spec.scale,h*p.spec.scale)):[];
    this.fsrcnnxTargets=useFsrcnnx?this.fsrcnnxPasses.map(p=>this.texture(w*p.spec.scale,h*p.spec.scale)):[];
    this.filterTargets=(['deblock','dering','denoise','deband'] as Stage[]).some(s=>active.includes(s))?[this.texture(w,h),this.texture(w,h)]:[];
    this.allocationKey=key;
  }
  private pass(encoder:GPUCommandEncoder,pipeline:GPURenderPipeline,resources:GPUBindingResource[],target:GPUTexture|GPUTextureView){
    const group=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
    const view='createView' in target?target.createView():target;
    const pass=encoder.beginRenderPass({colorAttachments:[{view,loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.draw(3);pass.end();
  }
  private model(encoder:GPUCommandEncoder,passes:Pass[],targets:GPUTexture[],input:GPUTexture,buffer:GPUBuffer){
    let prev=input;
    for(let i=0;i<passes.length;i++){
      this.pass(encoder,passes[i].pipeline,[prev.createView(),input.createView(),this.sampler,{buffer}],targets[i]);prev=targets[i];
    }
    return prev;
  }
  private runFsrcnnx(encoder:GPUCommandEncoder,input:GPUTexture){
    const saved=new Map<string,GPUTexture>([['LUMA',input]]);
    let result=input;
    this.fsrcnnxPasses.forEach(({spec,pipeline},index)=>{
      const sources=spec.binds.map(name=>{
        const texture=saved.get(name);if(!texture)throw Error(`模型缺少输入 ${name}`);return texture.createView();
      });
      while(sources.length<3)sources.push(input.createView());
      this.pass(encoder,pipeline,[...sources,input.createView(),this.sampler],this.fsrcnnxTargets[index]);
      result=this.fsrcnnxTargets[index];saved.set(spec.save,result);
    });
    return result;
  }
  render(video:HTMLVideoElement|VideoFrame,config:Config){
    const width='videoWidth' in video?video.videoWidth:video.displayWidth,height='videoHeight' in video?video.videoHeight:video.displayHeight;
    this.renderInput(width,height,config,encoder=>{
      const external=this.device.importExternalTexture({source:video,colorSpace:'srgb'});
      this.pass(encoder,this.inputPipeline,[external,this.sampler],this.source);
    });
  }
  /** Already-ingested sRGB RGBA16F pixels on this device; no CPU readback. */
  renderTexture(input:GPUTexture,config:Config){
    if(input.format!=='rgba16float'||!(input.usage&GPUTextureUsage.COPY_SRC)||input.sampleCount!==1||input.dimension!=='2d'||input.depthOrArrayLayers!==1)throw Error('输入必须为可复制的单层 RGBA16F 纹理');
    this.renderInput(input.width,input.height,config,encoder=>{
      encoder.copyTextureToTexture({texture:input},{texture:this.source},[input.width,input.height]);
    });
  }
  private renderInput(width:number,height:number,config:Config,ingestSource:(encoder:GPUCommandEncoder)=>void){
    if(this.stopped)throw Error('GPU 引擎已关闭');
    if(!width||!height)throw Error('视频尺寸尚未就绪');
    if(height>config.maxSourceHeight)throw Error(`当前安全上限为 ${config.maxSourceHeight}p，请降低视频清晰度`);
    const active=capabilities(config).active;
    this.resize(width,height,config);
    const useUpscale=active.includes('upscale');
    const outputWidth=width*(useUpscale?2:1),outputHeight=height*(useUpscale?2:1);
    if(this.canvas.width!==outputWidth||this.canvas.height!==outputHeight){this.canvas.width=outputWidth;this.canvas.height=outputHeight;}
    this.device.queue.writeBuffer(this.buffers[0],0,new Float32Array([config.stages.sharpen.strength,0,0,0]));
    this.device.queue.writeBuffer(this.buffers[1],0,new Float32Array([1,0,0,0]));
    this.device.queue.writeBuffer(this.buffers[2],0,new Float32Array([0,config.compare?1:0,0,0]));
    const encoder=this.device.createCommandEncoder();
    ingestSource(encoder);
    let processed=this.source;
    if(active.includes('deblock')){
      this.device.queue.writeBuffer(this.filterBuffers[0],0,new Float32Array([config.stages.deblock.strength,0,0,0]));
      this.device.queue.writeBuffer(this.filterBuffers[1],0,new Float32Array([config.stages.deblock.strength,1,0,0]));
      this.pass(encoder,this.deblockPipeline,[processed.createView(),{buffer:this.filterBuffers[0]}],this.filterTargets[0]);
      this.pass(encoder,this.deblockPipeline,[this.filterTargets[0].createView(),{buffer:this.filterBuffers[1]}],this.filterTargets[1]);
      processed=this.filterTargets[1];
      this.count('deblock');
    }
    const nextTarget=()=>this.filterTargets[0]===processed?this.filterTargets[1]:this.filterTargets[0];
    if(active.includes('dering')){const target=nextTarget();this.spatial!.dering(encoder,processed,target,config.stages.dering.strength);processed=target;this.count('dering');}
    if(active.includes('denoise')){const target=nextTarget();this.spatial!.denoise(encoder,processed,target,config.stages.denoise.strength);processed=target;this.count('denoise');}
    if(active.includes('deband')){
      this.device.queue.writeBuffer(this.filterBuffers[2],0,new Float32Array([config.stages.deband.strength,0,0,0]));
      const target=nextTarget();this.pass(encoder,this.debandPipeline,[processed.createView(),{buffer:this.filterBuffers[2]}],target);
      processed=target;
      this.count('deband');
    }
    this.prepared=processed;
    this.finish(encoder,processed,config,this.source);
    this.device.queue.submit([encoder.finish()]);
  }
  private finish(encoder:GPUCommandEncoder,processed:GPUTexture,config:Config,baseline:GPUTexture){
    const active=capabilities(config).active;const useUpscale=active.includes('upscale');
    if(active.includes('sharpen')&&config.stages.sharpen.algorithm==='restore-anime4k-s')processed=this.model(encoder,this.restore,this.restoreTargets,processed,this.buffers[0]);
    if(useUpscale)processed=this.configuredUpscale(encoder,processed,config);
    if(active.includes('sharpen')&&config.stages.sharpen.algorithm==='sharpen-cas'){
      this.pass(encoder,this.casPipeline,[processed.createView(),this.sampler,{buffer:this.buffers[0]}],this.casTarget);processed=this.casTarget;
    }
    this.pass(encoder,this.outputPipeline,[processed.createView(),baseline.createView(),this.sampler,{buffer:this.buffers[2]}],this.context.getCurrentTexture());
    if(active.includes('sharpen'))this.count('sharpen');if(useUpscale)this.count('upscale');
  }
  renderInterpolated(input:GPUTexture,config:Config,baseline:GPUTexture){
    const encoder=this.device.createCommandEncoder();this.finish(encoder,input,config,baseline);this.device.queue.submit([encoder.finish()]);
  }
  private clone(input:GPUTexture,format:GPUTextureFormat){
    const texture=this.snapshots!.acquire(input.width,input.height,format);
    const encoder=this.device.createCommandEncoder();encoder.copyTextureToTexture({texture:input},{texture},[input.width,input.height]);this.device.queue.submit([encoder.finish()]);return texture;
  }
  snapshot(){return this.clone(this.context.getCurrentTexture(),navigator.gpu.getPreferredCanvasFormat());}
  preprocessedSnapshot(){return this.clone(this.preprocessedInput,'rgba16float');}
  original(){return this.clone(this.source,'rgba16float');}
  releaseSnapshot(texture:GPUTexture){this.snapshots?.release(texture);}
  async completed(){const submitted={...this.submitted};await this.device.queue.onSubmittedWorkDone();for(const stage of Object.keys(submitted) as Stage[])this.completedStages[stage]=Math.max(this.completedStages[stage]??0,submitted[stage]!);}
  private configuredUpscale(encoder:GPUCommandEncoder,input:GPUTexture,config:Config){
    return config.stages.upscale.algorithm==='upscale-fsrcnnx-x2'?this.runFsrcnnx(encoder,input):this.model(encoder,this.upscale,this.upscaleTargets,input,this.buffers[1]);
  }
  dispose(){
    this.stopped=true;this.spatial?.dispose();this.snapshots?.dispose();
    this.textures.forEach(t=>t.destroy());this.textures=[];
    this.buffers.forEach(b=>b.destroy());this.buffers=[];
    this.filterBuffers.forEach(b=>b.destroy());this.filterBuffers=[];
    if(this.configured)this.context.unconfigure();
    if(this.ownsDevice)this.device?.destroy();
  }
}
