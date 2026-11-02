import {bilateral,bilateralParameters} from './bilateral';
import {dering} from './dering';
/** Two ordered scans preserve FFmpeg's unnormalized intermediate factors. */
export class SpatialCompute {
  private horizontal?:GPUComputePipeline;private vertical?:GPUComputePipeline;private ringing?:GPUComputePipeline;
  private uniform:GPUBuffer[]=[];private scratch:GPUBuffer[]=[];private scratchKey='';private stopped=false;
  constructor(private device:GPUDevice){}
  async init(denoise:boolean,removeRinging:boolean){
    if(denoise){
      const entries:GPUBindGroupLayoutEntry[]=[
        {binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float'}},
        {binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}},
        ...[2,3,4,5].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage' as GPUBufferBindingType}})),
        {binding:6,visibility:GPUShaderStage.COMPUTE,storageTexture:{format:'rgba16float',access:'write-only'}}
      ];
      this.horizontal=await this.pipeline(bilateral,'horizontal',entries);this.assertLive();
      this.vertical=await this.pipeline(bilateral,'vertical',entries);this.assertLive();
    }
    if(removeRinging){
      this.ringing=await this.pipeline(dering,'main',[
        {binding:0,visibility:GPUShaderStage.COMPUTE,texture:{sampleType:'float'}},
        {binding:1,visibility:GPUShaderStage.COMPUTE,storageTexture:{format:'rgba16float',access:'write-only'}},
        {binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'uniform'}}
      ]);this.assertLive();
    }
    if(denoise||removeRinging)for(let i=0;i<2;i++)this.uniform.push(this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
  }
  private async pipeline(code:string,entryPoint:string,entries:GPUBindGroupLayoutEntry[]){
    const module=this.device.createShaderModule({code});const info=await module.getCompilationInfo();
    const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>`${e.lineNum}: ${e.message}`).join('\n'));
    this.assertLive();
    const layout=this.device.createPipelineLayout({bindGroupLayouts:[this.device.createBindGroupLayout({entries})]});
    return this.device.createComputePipelineAsync({layout,compute:{module,entryPoint}});
  }
  private assertLive(){if(this.stopped)throw Error('空间滤镜初始化已取消');}
  private allocate(width:number,height:number){
    const key=`${width}x${height}`;if(this.scratchKey===key)return;
    const size=width*height*16;
    if(size>this.device.limits.maxStorageBufferBindingSize||size>this.device.limits.maxBufferSize)throw Error('降噪缓存超过 GPU 存储上限');
    this.scratch.forEach(b=>b.destroy());this.scratch=[];this.scratchKey='';
    for(let i=0;i<4;i++)this.scratch.push(this.device.createBuffer({size,usage:GPUBufferUsage.STORAGE}));
    this.scratchKey=key;
  }
  private dispatch(encoder:GPUCommandEncoder,pipeline:GPUComputePipeline,resources:GPUBindingResource[],x:number,y=1){
    const group=this.device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:resources.map((resource,binding)=>({binding,resource}))});
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(x,y);pass.end();
  }
  denoise(encoder:GPUCommandEncoder,input:GPUTexture,output:GPUTexture,strength:number){
    this.assertLive();if(!this.horizontal||!this.vertical)throw Error('降噪管线未初始化');
    const {width,height}=input;this.allocate(width,height);const {alpha,sigmaR}=bilateralParameters(strength);
    this.device.queue.writeBuffer(this.uniform[0],0,new Float32Array([width,height,alpha,sigmaR]));
    const bindings=[input.createView(),{buffer:this.uniform[0]},...this.scratch.map(buffer=>({buffer})),output.createView()];
    this.dispatch(encoder,this.horizontal,bindings,Math.ceil(height/64));
    this.dispatch(encoder,this.vertical,bindings,Math.ceil(width/64));
  }
  dering(encoder:GPUCommandEncoder,input:GPUTexture,output:GPUTexture,strength:number){
    this.assertLive();if(!this.ringing)throw Error('去振铃管线未初始化');
    this.device.queue.writeBuffer(this.uniform[1],0,new Float32Array([strength*16/255,0,0,0]));
    this.dispatch(encoder,this.ringing,[input.createView(),output.createView(),{buffer:this.uniform[1]}],Math.ceil(input.width/8),Math.ceil(input.height/8));
  }
  dispose(){this.stopped=true;this.scratch.forEach(b=>b.destroy());this.scratch=[];this.uniform.forEach(b=>b.destroy());this.uniform=[];}
}
