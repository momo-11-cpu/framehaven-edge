import {GpuEngine} from './gpu';
import {FramegenSession as InterpolationSession} from './framegen';
import {PresentationQueue,pairTiming,syncLatency,presentationCapacity,sourceFrameRate} from './presentation';
import {capabilities,normalize,labels,type Config} from '../core/config';
import type {FrameStamp} from './frame-stamp';
import {present} from './shaders';
import type {RuntimeStatus} from '../core/config';
import {stageStates} from '../core/stage-status';
export class TemporalBridge {
  onLost:(message:string)=>void=()=>{};
  profileMs=0;latencyMs=0;
  private host:ReturnType<typeof createHost>;
  constructor(canvas:HTMLCanvasElement,report:(status:RuntimeStatus)=>void){this.host=createHost(canvas,report,message=>this.onLost(message));}
  async init(config:Config,width:number,height:number){const result=await this.host.init(config,width,height);this.profileMs=result.profileMs;this.latencyMs=result.latencyMs;}
  capture(video:HTMLVideoElement,stamp:FrameStamp){return this.host.frame(new VideoFrame(video,{timestamp:Math.round(stamp.mediaTime*1e6)}),stamp);}
  dispose(){void this.host.dispose();}
}
function createHost(screen:HTMLCanvasElement,report:(status:RuntimeStatus)=>void,onLost:(message:string)=>void){
let engine:GpuEngine|undefined,model:InterpolationSession|undefined;
let queue:PresentationQueue<GPUTexture>|undefined,device:GPUDevice|undefined,config:Config;
let history:{stamp:FrameStamp;input:GPUTexture;raw:GPUTexture}|undefined;
let stopped=false,busy=false,raf=0,lastContact=performance.now(),overruns=0,presented=0,generated=0;
let presentationPipeline:GPURenderPipeline,context:GPUCanvasContext,sampler:GPUSampler,params:GPUBuffer;
let profileMs=0,latencyMs=0,inference:Promise<void>|undefined;let lastReport=performance.now(),lastSource:FrameStamp|undefined,sourceFps=0,processingMs=0;
let readyAt=0,lastSkips=0,sourceSize='',generatedTotal=0,busyPairs=0,displayHz=0,lastTick=0;

const now=()=>performance.timeOrigin+performance.now();
const send=(value:{type:string;status?:RuntimeStatus;message?:string})=>{if(value.type==='status'&&value.status)report(value.status);else if(value.type==='error')onLost(value.message??'GPU 处理失败');};
async function dispose(){
  if(stopped)return;stopped=true;cancelAnimationFrame(raf);queue?.reset();if(history){engine?.releaseSnapshot(history.raw);engine?.releaseSnapshot(history.input);}history=undefined;
  await inference;await model?.dispose();engine?.dispose();params?.destroy();context?.unconfigure();
}
function fail(error:unknown){send({type:'error',message:error instanceof Error?error.message:String(error)});void dispose();}
function show(texture:GPUTexture){
  const passEncoder=device!.createCommandEncoder();
  const group=device!.createBindGroup({layout:presentationPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:texture.createView()},{binding:1,resource:texture.createView()},{binding:2,resource:sampler},{binding:3,resource:{buffer:params}}]});
  const p=passEncoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});p.setPipeline(presentationPipeline);p.setBindGroup(0,group);p.draw(3);p.end();device!.queue.submit([passEncoder.finish()]);
}
function tick(){
  if(stopped)return;
  try{
    const clock=performance.now();if(lastTick){const delta=clock-lastTick;if(delta>3&&delta<50)displayHz=displayHz?displayHz*.95+(.05*1000/delta):1000/delta;}lastTick=clock;
    const due=queue?.due(now());if(due){show(due.resource);presented++;if(due.kind==='generated')generated++;}

    if(performance.now()-lastReport>1000){
      const plan=capabilities(config),elapsed=(performance.now()-lastReport)/1000;
      const skips=(model?.duplicatePairs??0)+(model?.cutPairs??0),skippedFps=(skips-lastSkips)/elapsed;lastSkips=skips;
      const factor=config.interpolationFactor,targetFps=sourceFps*factor;
      const generatedFps=generated/elapsed,underTarget=!!model&&performance.now()-readyAt>5000&&sourceFps>0&&generatedFps<Math.max(0,sourceFps-skippedFps)*(factor-1)*.85;
      const displayLimited=displayHz>0&&targetFps>displayHz*1.08;
      const detail=`已生成 ${generatedTotal} 帧；当前呈现 ${generatedFps.toFixed(1)} 帧/秒；重复跳过 ${model?.duplicatePairs??0} 对，切镜 ${model?.cutPairs??0} 对，忙碌跳过 ${busyPairs} 对`;
      send({type:'status',status:{state:plan.missing.length||underTarget?'degraded':'active',message:`${underTarget?'补帧呈现未达目标':'增强运行中'}；${model?.backend??''}；${factor}× 目标 ${targetFps.toFixed(0)} fps，同步缓冲 ${latencyMs} ms${displayLimited?'；页面刷新速率低于目标帧率':''}`,active:plan.active,missing:plan.missing,source:sourceSize,sourceFps,outputFps:presented/elapsed,generatedFps,lateFrames:overruns,queueDepth:queue?.size,processingMs,frames:presented,generatedTotal,duplicatePairs:model?.duplicatePairs??0,cutPairs:model?.cutPairs??0,busyPairs,displayDropped:queue?.dropped??0,displayHz,targetFps,interpolationFactor:factor,stages:stageStates(config,engine?.completedStages??{},{completed:generatedTotal,detail})}});
      lastReport=performance.now();presented=0;generated=0;
    }
    raf=requestAnimationFrame(tick);
  }catch(error){fail(error);}
}
async function frame(video:VideoFrame,stamp:FrameStamp){
  if(stopped||busy){video.close();send({type:'done'});return;}busy=true;lastContact=performance.now();const begin=performance.now();

  try{
    const temporal=!!model;
    let sourceComplete:Promise<void>|undefined;
    if(video.displayHeight>config.maxSourceHeight)throw Error('视频尺寸超过安全上限');
    engine!.render(video,config);
    const original=engine!.snapshot();
    if(!history&&temporal)show(original);
    queue!.enqueue({at:temporal?stamp.displayTime+latencyMs:now(),resource:original,kind:'original',epoch:queue!.epoch},now());
    if(temporal){
      const previous=history;
      history={stamp,input:engine!.preprocessedSnapshot(),raw:engine!.original()};
      // Fence only source work submitted so far. New source batches cannot build
      // an unbounded backlog behind an in-flight model on the shared GPU queue.
      sourceComplete=engine!.completed();
      const timing=previous?pairTiming(previous.stamp,stamp,latencyMs):undefined;
      const consecutive=!previous?.stamp.frameNumber||!stamp.frameNumber||stamp.frameNumber-previous.stamp.frameNumber===1;
      if(previous&&timing&&consecutive&&!inference){
        // Stable inference buffers are written only when no inference is in flight.
        model!.capture(previous.input,0);model!.capture(history.input,1);
        const epoch=queue!.epoch;
        inference=(async()=>{
          const started=performance.now();
          try{
            if(await model!.sceneCut(0,1)||stopped)return;
            await model!.generate(0,1,config.interpolationFactor,async(middle,t)=>{
              if(stopped)return;generatedTotal++;
              const at=previous.stamp.displayTime+timing.intervalMs*t+latencyMs;
              if(now()<=at+8){
                engine!.renderInterpolated(middle,config,previous.raw);
                const output=engine!.snapshot();await engine!.completed();
                if(stopped){engine!.releaseSnapshot(output);return;}
                queue!.enqueue({at,resource:output,kind:'generated',epoch},now());
              }else overruns++;
            });
            processingMs=performance.now()-started;
          }catch(error){if(!stopped)fail(error);}
          finally{engine?.releaseSnapshot(previous.input);engine?.releaseSnapshot(previous.raw);inference=undefined;}
        })();
      }else if(previous){if(timing&&consecutive&&inference)busyPairs++;engine!.releaseSnapshot(previous.input);engine!.releaseSnapshot(previous.raw);}
    }
    await (sourceComplete??engine!.completed());
    if(stopped)return;
    if(lastSource){const fps=sourceFrameRate(lastSource,stamp);if(fps!==undefined)sourceFps=sourceFps?sourceFps*.85+.15*fps:fps;}
    lastSource=stamp;if(!temporal)processingMs=performance.now()-begin;
    send({type:'done'});
  }catch(error){fail(error);throw error;}finally{video.close();busy=false;}
}
async function init(value:Config,width:number,height:number){config=normalize(value);try{
    sourceSize=`${width} × ${height}`;
    
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||height>config.maxSourceHeight||width>8192)throw Error('无效的视频尺寸');
    const temporal=config.stages.interpolation.enabled&&config.stages.interpolation.strength>0;
    if(temporal){
      model=new InterpolationSession(new URL(typeof chrome!=='undefined'&&chrome.runtime?.getURL?chrome.runtime.getURL('./'):new URL('./',location.href).href));
      await model.init(config.stages.interpolation.algorithm==='interp-framegen-anime'?'framegen-anime':'framegen-live',width,height);device=await model.device;
      if(stopped)return;
      // Compile model kernels before audio interception and real-time presentation.
      await model.generate(0,1,config.interpolationFactor,()=>{});await device.queue.onSubmittedWorkDone();
      const samples:number[]=[];for(let i=0;i<3;i++){const begin=performance.now();await model.generate(0,1,config.interpolationFactor,()=>{});await device.queue.onSubmittedWorkDone();samples.push(performance.now()-begin);}
      profileMs=samples.reduce((a,b)=>a+b,0)/samples.length;latencyMs=syncLatency(profileMs);
      if(stopped)return;
    }
    const work=document.createElement('canvas');engine=new GpuEngine(work);await engine.init(config,device);device=engine.gpuDevice;if(stopped)return;
    engine.onLost=fail;
    const scale=config.stages.upscale.enabled?2:1;screen.width=width*scale;screen.height=height*scale;
    context=screen.getContext('webgpu')!;context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
    const shader=device.createShaderModule({code:present});
    const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},{binding:3,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
    presentationPipeline=await device.createRenderPipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module:shader,entryPoint:'vs'},fragment:{module:shader,entryPoint:'fs',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]}});
    sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});params=device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(params,0,new Float32Array([0,0,0,0]));
    queue=new PresentationQueue(texture=>engine?.releaseSnapshot(texture),presentationCapacity(latencyMs,config.interpolationFactor));readyAt=lastReport=performance.now();lastContact=performance.now();tick();return {profileMs,latencyMs};

}catch(error){await dispose();throw error;}}
return {init:async(value:Config,width:number,height:number)=>{const result=await init(value,width,height);if(!result)throw Error('初始化已取消');return result;},frame,dispose};
}

