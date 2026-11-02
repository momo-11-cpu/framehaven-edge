/** Keep a direct audio route when enhancement stops: MediaElementSource binding is permanent. */
interface Route {source:MediaElementAudioSourceNode;delay?:DelayNode;context:AudioContext;owners:number}
const routes=new WeakMap<HTMLMediaElement,Route>();
let audioContext:AudioContext|undefined;
export class AudioDelay {
  private route?:Route;private generation=0;
  constructor(private video:HTMLVideoElement){}
  get active(){return !!this.route;}
  get healthy(){return !this.route||this.route.context.state==='running';}
  async start(milliseconds:number){
    const generation=++this.generation;
    if(this.video.muted||this.video.volume===0)return;
    audioContext??=new AudioContext();
    // Resume before intercepting media audio. A denied resume must leave native audio untouched.
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([audioContext.resume(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器暂未允许音频同步')),2500);})]);}finally{if(timer)clearTimeout(timer);}
    if(generation!==this.generation)return;
    if(audioContext.state!=='running')throw Error('浏览器尚未允许音频同步，请在播放页面点击播放后重试');
    let route=routes.get(this.video);
    if(!route){const source=audioContext.createMediaElementSource(this.video);route={source,context:audioContext,owners:0};routes.set(this.video,route);source.connect(audioContext.destination);}
    if(route.owners)throw Error('音频同步已由另一播放管线持有');
    const delay=route.context.createDelay(1);delay.delayTime.value=milliseconds/1000;
    route.source.disconnect();route.source.connect(delay);delay.connect(route.context.destination);route.delay=delay;route.owners=1;this.route=route;
  }
  stop(){
    this.generation++;const route=this.route;if(!route)return;this.route=undefined;
    route.source.disconnect();route.delay?.disconnect();route.delay=undefined;route.owners=0;route.source.connect(route.context.destination);
  }
}
