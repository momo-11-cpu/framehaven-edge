import type {FrameStamp} from './frame-stamp';
import {TemporalBridge} from './temporal-bridge';
import {SpatialBridge} from './spatial-bridge';
import {AudioDelay} from './audio';
import {capabilities,type Config,type RuntimeStatus} from '../core/config';
import {fitRect} from '../core/geometry';
export class VideoController {
  private engine?:TemporalBridge|SpatialBridge;private canvas?:HTMLIFrameElement|HTMLCanvasElement;
  private audio:AudioDelay;private temporalFailure='';private effective!:Config;private stamp?:FrameStamp;
  private epoch=0;private callback?:number;private busy=false;private started=false;
  private observer?:ResizeObserver;private positionTimer?:ReturnType<typeof setInterval>;
  private previousPosition='';private changedPosition=false;private parent?:HTMLElement;
  private abort=new AbortController();
  constructor(readonly video:HTMLVideoElement,private config:Config,readonly report:(status:RuntimeStatus)=>void,private readonly canSubmit:()=>boolean=()=>true){
    this.audio=new AudioDelay(video);
    for(const event of ['seeking','emptied','loadedmetadata','enterpictureinpicture','leavepictureinpicture','pause','play','ratechange','resize'])video.addEventListener(event,()=>void this.restart(),{signal:this.abort.signal});
    video.addEventListener('volumechange',()=>{if(this.started&&!video.paused&&this.effective.stages.interpolation.enabled&&!video.muted&&video.volume>0&&!this.audio.active)void this.restart();},{signal:this.abort.signal});
    document.addEventListener('fullscreenchange',()=>void this.restart(),{signal:this.abort.signal});
  }
  update(config:Config){this.config=config;this.temporalFailure='';void this.restart();}
  private stop(){
    this.epoch++;this.started=false;this.audio.stop();this.stamp=undefined;
    if(this.callback!==undefined)this.video.cancelVideoFrameCallback(this.callback);this.callback=undefined;
    this.observer?.disconnect();this.observer=undefined;
    if(this.positionTimer)clearInterval(this.positionTimer);this.positionTimer=undefined;
    this.engine?.dispose();this.engine=undefined;this.canvas?.remove();this.canvas=undefined;
    if(this.changedPosition&&this.parent){this.parent.style.position=this.previousPosition;this.changedPosition=false;}
    this.busy=false;
  }
  private fail(error:unknown,epoch:number){
    if(epoch!==this.epoch)return;
    const message=error instanceof Error?error.message:String(error);
    if(this.effective.stages.interpolation.enabled){this.temporalFailure=message;void this.restart();}
    else{this.stop();this.report({state:'error',message});}
  }
  async start(){
    this.stop();const epoch=this.epoch;
    this.effective=structuredClone(this.config);
    if(this.temporalFailure||this.video.paused||this.video.playbackRate!==1)this.effective.stages.interpolation.enabled=false;
    const plan=capabilities(this.effective);
    if(this.config.mode==='off'||plan.status==='off'){this.report({state:'off',message:'所有增强已关闭，正在使用原生画面'});return;}
    if(!plan.active.length){this.report({state:'unsupported',message:'所选算法尚未就绪；原生画面继续播放',missing:plan.missing,active:[]});return;}
    if(document.hidden){this.report({state:'suspended',message:'后台标签页已暂停增强'});return;}
    if(this.video.controls){this.report({state:'unsupported',message:'此版本保留原生视频控件，暂不覆盖该播放器'});return;}
    if(this.video.mediaKeys){this.report({state:'unsupported',message:'受保护的视频使用原生播放'});return;}
    if(document.pictureInPictureElement===this.video||document.fullscreenElement===this.video){this.report({state:'suspended',message:'视频独立全屏或画中画使用原生播放'});return;}
    if(this.video.readyState<2||!this.video.videoWidth){this.report({state:'idle',message:'等待视频就绪'});return;}
    if(!this.video.requestVideoFrameCallback||typeof VideoFrame==='undefined'){this.report({state:'unsupported',message:'浏览器缺少所需的视频帧接口'});return;}
    const parent=this.video.parentElement;if(!parent){this.report({state:'idle',message:'等待播放器容器'});return;}
    this.report({state:'warming',message:this.effective.stages.interpolation.enabled?'正在初始化补帧模型，首次运行需要编译':'正在初始化 GPU 处理',active:plan.active,missing:plan.missing});
    const temporal=this.effective.stages.interpolation.enabled;
    const canvas=document.createElement('canvas');canvas.title='帧境视频增强输出';if(temporal)canvas.setAttribute('allow','autoplay');canvas.dataset.framehaven='overlay';canvas.setAttribute('aria-hidden','true');canvas.tabIndex=-1;
    Object.assign(canvas.style,{position:'absolute',pointerEvents:'none',zIndex:'1',display:'none',border:'0'});
    this.canvas=canvas;this.parent=parent;this.previousPosition=parent.style.position;
    if(getComputedStyle(parent).position==='static'){parent.style.position='relative';this.changedPosition=true;}
    parent.append(canvas);
    const receive=(status:RuntimeStatus)=>{
      if(epoch!==this.epoch||!this.started)return;
      if(this.config.stages.interpolation.enabled&&!this.effective.stages.interpolation.enabled){
        const reason=this.temporalFailure||'暂停或倍速播放';
        status={...status,state:'degraded',message:`空间增强运行中；补帧暂停：${reason}`,missing:[...(status.missing??[]),'interpolation']};
      }
      this.report(status);
    };
    const engine=temporal?new TemporalBridge(canvas,receive):new SpatialBridge(canvas,receive);this.engine=engine;engine.onLost=message=>this.fail(Error(message),epoch);
    try{
      await engine.init(this.effective,this.video.videoWidth,this.video.videoHeight);if(epoch!==this.epoch)return;
      // Verify origin-clean frame transfer/import before touching media audio.
      await engine.capture(this.video,{mediaTime:this.video.currentTime,displayTime:performance.timeOrigin+performance.now(),rate:this.video.playbackRate});
      if(epoch!==this.epoch)return;
      if(this.effective.stages.interpolation.enabled)await this.audio.start(engine instanceof TemporalBridge?engine.latencyMs:0);
      if(epoch!==this.epoch)return;
      this.position();this.started=true;
      this.observer=new ResizeObserver(()=>{try{this.position();}catch(error){this.fail(error,epoch);}});
      this.observer.observe(this.video);this.observer.observe(parent);
      this.positionTimer=setInterval(()=>{
        if(!this.video.isConnected||document.hidden||!this.canSubmit()){this.stop();this.report({state:'suspended',message:'页面不可见或 GPU 使用时限已过，已暂停增强'});return;}
        if(this.audio.active&&!this.audio.healthy){this.fail(Error('音频时钟暂停，已停止延迟画面以避免音画错位'),epoch);return;}
        try{this.position();}catch(error){this.fail(error,epoch);}
      },350);
      if(this.canvas)this.canvas.style.display='block';receive({state:'active',message:this.video.paused?'暂停画面已增强':'画质增强已启动',active:plan.active,missing:plan.missing});this.schedule();
    }catch(error){this.fail(error,epoch);}
  }
  private position(){
    if(!this.canvas||!this.parent)return;
    const box=this.video.getBoundingClientRect(),parentBox=this.parent.getBoundingClientRect();
    const style=getComputedStyle(this.video);
    if(style.transform!=='none')throw Error('此版本暂不支持视频元素旋转或变换');
    const fit=fitRect({width:this.video.clientWidth,height:this.video.clientHeight},{width:this.video.videoWidth,height:this.video.videoHeight},style.objectFit,style.objectPosition);
    const sx=this.parent.offsetWidth?parentBox.width/this.parent.offsetWidth:1;
    const sy=this.parent.offsetHeight?parentBox.height/this.parent.offsetHeight:1;
    Object.assign(this.canvas.style,{
      left:`${(box.left-parentBox.left)/sx+this.parent.scrollLeft-this.parent.clientLeft+fit.left}px`,
      top:`${(box.top-parentBox.top)/sy+this.parent.scrollTop-this.parent.clientTop+fit.top}px`,
      width:`${fit.width}px`,height:`${fit.height}px`,borderRadius:style.borderRadius
    });
    const visible=box.width>0&&box.height>0&&box.bottom>0&&box.top<innerHeight&&box.right>0&&box.left<innerWidth;
    this.canvas.style.visibility=visible?'visible':'hidden';
  }
  private schedule(){
    if(!this.started||this.callback!==undefined||this.video.paused)return;
    this.callback=this.video.requestVideoFrameCallback((_now,metadata)=>{
      this.callback=undefined;
      this.stamp={mediaTime:metadata.mediaTime,displayTime:performance.timeOrigin+metadata.expectedDisplayTime,rate:this.video.playbackRate,frameNumber:metadata.presentedFrames};
      this.drawOnce();this.schedule();
    });
  }
  private drawOnce(){
    if(!this.started||this.busy||!this.engine||document.hidden||this.video.seeking||this.video.readyState<2)return;
    if(!this.canSubmit()){this.stop();this.report({state:'suspended',message:'GPU 使用时限已过，已暂停增强'});return;}
    const rect=this.video.getBoundingClientRect();if(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)return;
    const epoch=this.epoch;this.busy=true;
    const stamp=this.stamp??{mediaTime:this.video.currentTime,displayTime:performance.timeOrigin+performance.now(),rate:this.video.playbackRate};
    this.engine.capture(this.video,stamp).then(()=>{if(epoch===this.epoch)this.busy=false;}).catch(error=>this.fail(error,epoch));
  }
  async restart(){return this.start();}
  dispose(){this.stop();this.abort.abort();}
}
