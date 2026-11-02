import {GpuEngine} from './gpu';
import {capabilities,type Config,type RuntimeStatus} from '../core/config';
import type {FrameStamp} from './frame-stamp';
import {sourceFrameRate} from './presentation';
import {stageStates} from '../core/stage-status';
/** Spatial-only fallback stays inside the content script and needs no embedded extension page. */
export class SpatialBridge {
  private gpu:GpuEngine;private config!:Config;private start=performance.now();private frames=0;private previous?:FrameStamp;private sourceFps=0;private average=0;private overruns=0;
  onLost:(message:string)=>void=()=>{};
  constructor(canvas:HTMLCanvasElement,private report:(status:RuntimeStatus)=>void){this.gpu=new GpuEngine(canvas);this.gpu.onLost=message=>this.onLost(message);}
  async init(config:Config,_width:number,_height:number){this.config=config;await this.gpu.init(config);}
  async capture(video:HTMLVideoElement,stamp:FrameStamp){
    const start=performance.now();this.gpu.render(video,this.config);await this.gpu.completed();const duration=performance.now()-start;
    this.average=this.average?this.average*.85+duration*.15:duration;
    this.overruns=duration>80?this.overruns+1:Math.max(0,this.overruns-1);if(this.overruns>=10)throw Error('GPU 持续超预算，已恢复原画');
    if(this.previous){const fps=sourceFrameRate(this.previous,stamp);if(fps!==undefined)this.sourceFps=this.sourceFps?this.sourceFps*.85+.15*fps:fps;}this.previous=stamp;this.frames++;
    const elapsed=(performance.now()-this.start)/1000;if(this.frames===1||elapsed>=1){
      const plan=capabilities(this.config);this.report({state:plan.missing.length?'degraded':'active',message:'空间增强正在运行',active:plan.active,missing:plan.missing,source:`${video.videoWidth} × ${video.videoHeight}`,sourceFps:this.sourceFps,outputFps:elapsed>.1?this.frames/elapsed:0,processingMs:this.average,frames:this.frames,stages:stageStates(this.config,this.gpu.completedStages)});this.frames=0;this.start=performance.now();
    }
  }
  dispose(){this.gpu.dispose();}
}
