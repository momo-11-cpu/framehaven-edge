import {afterEach,expect,it,vi} from 'vitest';
import {GpuEngine} from '../src/engine/gpu';
import {preset,stages} from '../src/core/config';
function setup(){
  const textures:{width:number;height:number;destroy:ReturnType<typeof vi.fn>;createView:()=>object}[]=[];
  const buffers:{destroy:ReturnType<typeof vi.fn>}[]=[];
  const context={configure:vi.fn(),unconfigure:vi.fn(),getCurrentTexture:()=>({createView:()=>({})})};
  const pass={setPipeline:vi.fn(),setBindGroup:vi.fn(),draw:vi.fn(),end:vi.fn()};
  const device={
    lost:new Promise(()=>{}),addEventListener:vi.fn(),limits:{maxTextureDimension2D:8192,maxBufferSize:268435456,maxStorageBufferBindingSize:134217728},
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),
    createBindGroupLayout:vi.fn(),createPipelineLayout:vi.fn(),
    createComputePipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
    createRenderPipelineAsync:async()=>({getBindGroupLayout:()=>({})}),
    createSampler:()=>({}),createBuffer:()=>{const buffer={destroy:vi.fn()};buffers.push(buffer);return buffer;},
    createTexture:({size}:{size:number[]})=>{const texture={width:size[0],height:size[1],destroy:vi.fn(),createView:()=>({})};textures.push(texture);return texture;},
    createBindGroup:vi.fn(),importExternalTexture:vi.fn(()=>({})),destroy:vi.fn(),
    copyTextureToTexture:vi.fn(),
    createCommandEncoder:()=>({copyTextureToTexture:device.copyTextureToTexture,beginRenderPass:()=>pass,beginComputePass:()=>({...pass,dispatchWorkgroups:vi.fn()}),finish:()=>({})}),
    queue:{writeBuffer:vi.fn(),submit:vi.fn(),onSubmittedWorkDone:async()=>{}}
  };
  vi.stubGlobal('GPUTextureUsage',{TEXTURE_BINDING:1,RENDER_ATTACHMENT:2,COPY_SRC:4,STORAGE_BINDING:8,COPY_DST:16});
  vi.stubGlobal('GPUBufferUsage',{UNIFORM:1,COPY_DST:2,STORAGE:4});
  vi.stubGlobal('GPUShaderStage',{FRAGMENT:2,COMPUTE:4});
  vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({requestDevice:async()=>device}),getPreferredCanvasFormat:()=> 'bgra8unorm'}});
  const canvas={width:0,height:0,getContext:()=>context} as unknown as HTMLCanvasElement;
  return {engine:new GpuEngine(canvas),device,textures,buffers,context,canvas};
}
afterEach(()=>vi.unstubAllGlobals());
function custom(){const c=preset('custom');for(const stage of stages)c.stages[stage].enabled=false;return c;}
const video={videoWidth:1920,videoHeight:1080} as HTMLVideoElement;
it('publishes per-stage execution after the GPU fence and counts generated postprocessing separately',async()=>{
 const {engine,device}=setup();const c=preset();await engine.init(c);engine.render(video,c);
 expect(engine.completedStages).toEqual({});let release!:()=>void;
 device.queue.onSubmittedWorkDone=()=>new Promise<void>(r=>release=r);
 const done=engine.completed();expect(engine.completedStages).toEqual({});release();await done;
 expect(engine.completedStages).toMatchObject({deblock:1,dering:1,denoise:1,deband:1,sharpen:1,upscale:1});
 engine.renderInterpolated({createView:()=>({})} as GPUTexture,c,{createView:()=>({})} as GPUTexture);
 const second=engine.completed();release();await second;
 expect(engine.completedStages).toMatchObject({deblock:1,sharpen:2,upscale:2});engine.dispose();
});
it('CAS-only allocates two textures instead of the entire model graph',async()=>{
  const {engine,textures,buffers,device,context}=setup();await engine.init();
  const c=custom();c.stages.sharpen.enabled=true;engine.render(video,c);
  expect(textures).toHaveLength(2);expect(textures.every(t=>t.width===1920&&t.height===1080)).toBe(true);
  engine.render(video,c);expect(textures).toHaveLength(2);
  engine.dispose();expect(textures.every(t=>t.destroy.mock.calls.length===1)).toBe(true);
  expect(buffers.every(b=>b.destroy.mock.calls.length===1)).toBe(true);expect(device.destroy).toHaveBeenCalledOnce();expect(context.unconfigure).toHaveBeenCalledOnce();
});
it('processes GPU-resident input without importing or reading back a video frame',async()=>{
  const {engine,device,canvas}=setup();const c=custom();c.stages.upscale.enabled=true;await engine.init(c);
  const input={width:1920,height:1080,format:'rgba16float',usage:GPUTextureUsage.COPY_SRC,sampleCount:1,dimension:'2d',depthOrArrayLayers:1} as GPUTexture;
  engine.renderTexture(input,c);expect(device.importExternalTexture).not.toHaveBeenCalled();expect(device.copyTextureToTexture).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(3840);expect(canvas.height).toBe(2160);
  expect(()=>engine.renderTexture({...input,format:'rgba8unorm'} as GPUTexture,c)).toThrow('RGBA16F');engine.dispose();
});
it('sizes CAS after real CNN upscaling and disposes old graph when options change',async()=>{
  const {engine,textures,canvas}=setup();await engine.init();
  const c=custom();c.stages.sharpen.enabled=true;c.stages.upscale={enabled:true,algorithm:'upscale-anime4k-x2-s',strength:1};
  engine.render(video,c);expect(canvas.width).toBe(3840);expect(canvas.height).toBe(2160);
  expect(textures).toHaveLength(7);expect(textures[1].width).toBe(3840);
  const old=[...textures];c.stages.upscale.enabled=false;engine.render(video,c);
  expect(old.every(t=>t.destroy.mock.calls.length===1)).toBe(true);expect(canvas.width).toBe(1920);
  engine.dispose();
});
it('allocates bounded ping-pong resources for deblock and deband',async()=>{
  const {engine,textures,device}=setup();await engine.init();const c=custom();c.stages.deblock.enabled=true;c.stages.deband.enabled=true;
  engine.render(video,c);expect(textures).toHaveLength(3);
  for(let i=0;i<20;i++)engine.render(video,c);
  expect(textures).toHaveLength(3);expect(device.queue.submit).toHaveBeenCalledTimes(21);engine.dispose();
});
it('cancels initialization before allocating buffers if disposed during async pipeline creation',async()=>{
  const {engine,device,buffers}=setup();let release!:()=>void;
  const gate=new Promise<void>(r=>release=r);
  device.createRenderPipelineAsync=async()=>{await gate;return {getBindGroupLayout:()=>({})};};
  const initializing=engine.init();
  await vi.waitFor(()=>expect(device.createShaderModule).toBeDefined());
  engine.dispose();release();await expect(initializing).rejects.toThrow('取消');
  expect(buffers).toHaveLength(0);
});
it('runs the named FSRCNNX graph at 2x without unbounded allocation',async()=>{
  const {engine,textures,canvas,device}=setup();const c=custom();c.stages.upscale.enabled=true;
  await engine.init(c);engine.render(video,c);
  expect(textures).toHaveLength(15);expect(canvas.width).toBe(3840);expect(canvas.height).toBe(2160);
  for(let i=0;i<12;i++)engine.render(video,c);
  expect(textures).toHaveLength(15);expect(device.queue.submit).toHaveBeenCalledTimes(13);
  engine.dispose();expect(textures.every(t=>t.destroy.mock.calls.length===1)).toBe(true);
});
it('compiles only selected pipelines when the controller supplies its config',async()=>{
  const {engine,device}=setup();const c=custom();c.stages.sharpen.enabled=true;
  const spy=vi.spyOn(device,'createRenderPipelineAsync');await engine.init(c);
  expect(spy).toHaveBeenCalledTimes(3);engine.render(video,c);engine.dispose();
});
it('combines all spatial filters with disjoint ping-pong inputs and bounded scan buffers',async()=>{
  const {engine,textures,buffers,device}=setup();const c=custom();
  for(const s of ['deblock','dering','denoise','deband'] as const)c.stages[s].enabled=true;
  await engine.init(c);engine.render(video,c);
  expect(textures).toHaveLength(3);expect(buffers).toHaveLength(12);
  for(let i=0;i<8;i++)engine.render(video,c);
  expect(textures).toHaveLength(3);expect(buffers).toHaveLength(12);
  // Every source texture binding must differ from its storage output view.
  expect(device.queue.submit).toHaveBeenCalledTimes(9);
  engine.dispose();expect(buffers.every(b=>b.destroy.mock.calls.length===1)).toBe(true);
});
