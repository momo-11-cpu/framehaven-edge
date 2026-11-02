import {preset,stages,type Config,type RuntimeStatus} from './core/config';
import {VideoController} from './engine/controller';
import './demo.css';
const video=document.querySelector<HTMLVideoElement>('#video')!;
const source=document.createElement('canvas');source.width=640;source.height=360;
const ctx=source.getContext('2d')!;
let count=0;let clock=0;let stream:MediaStream|undefined;
function draw(time:number){
  if(time-clock>1000/24){
    clock=time;count++;
    const gradient=ctx.createLinearGradient(0,0,640,360);gradient.addColorStop(0,'#11223b');gradient.addColorStop(.5,'#406984');gradient.addColorStop(1,'#cedde0');ctx.fillStyle=gradient;ctx.fillRect(0,0,640,360);
    ctx.strokeStyle='#f4e2b5';ctx.lineWidth=1;
    for(let i=0;i<22;i++){ctx.beginPath();ctx.moveTo(30+i*7,70);ctx.lineTo(30+i*7+70,260);ctx.stroke();}
    const x=350+Math.sin(count/24)*110;ctx.fillStyle='#a6d7e5';ctx.beginPath();ctx.arc(x,170,46,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#172b42';ctx.fillRect(28,285,584,50);ctx.fillStyle='#e2edf5';ctx.font='18px sans-serif';ctx.fillText('SDR / 640 × 360 / 24 fps',44,316);
    ctx.fillStyle='#fff';ctx.font='13px sans-serif';ctx.fillText(`Frame ${count}`,510,36);
    for(let i=0;i<10;i++){ctx.fillStyle=`rgb(${25+i*4},${30+i*4},${45+i*4})`;ctx.fillRect(250+i*15,230,15,40);}
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
const result=document.querySelector('#result')!;const log=document.querySelector('#log')!;
let controller:VideoController|undefined;let current:Config|undefined;
const report=(status:RuntimeStatus)=>{
  result.textContent=status.message;
  result.setAttribute('data-state',status.state);
  log.textContent=JSON.stringify(status,null,2);
};
async function play(){if(syncUrl){await video.play();return;}if(!stream){stream=source.captureStream(24);video.srcObject=stream;}await video.play();}
document.querySelector('#play')!.addEventListener('click',()=>void play().then(()=>report({state:'idle',message:'测试视频正在播放，可从 Edge 扩展面板接入'})));
function config(anime:boolean){const c=preset('custom');for(const s of stages)c.stages[s].enabled=false;c.stages.sharpen={enabled:true,algorithm:anime?'restore-anime4k-s':'sharpen-cas',strength:anime?1:.5};if(anime)c.stages.upscale={enabled:true,algorithm:'upscale-anime4k-x2-s',strength:1};return c;}
async function run(anime:boolean){controller?.dispose();await play();current=config(anime);controller=new VideoController(video,current,report);await controller.start();}
for(const [id,mode]of [['live-pipeline','live'],['anime-pipeline','anime']] as const)document.querySelector('#'+id)!.addEventListener('click',()=>{void(async()=>{controller?.dispose();await play();current=preset(mode);controller=new VideoController(video,current,report);await controller.start();})();});

document.querySelector('#cas')!.addEventListener('click',()=>void run(false));
document.querySelector('#anime')!.addEventListener('click',()=>void run(true));
document.querySelector('#fsrcnnx')!.addEventListener('click',()=>{
  void (async()=>{controller?.dispose();await play();current=config(false);current.stages.upscale={enabled:true,algorithm:'upscale-fsrcnnx-x2',strength:1};controller=new VideoController(video,current,report);await controller.start();})();
});

document.querySelector('#filters')!.addEventListener('click',()=>{
  void (async()=>{controller?.dispose();await play();current=config(false);current.stages.sharpen.enabled=false;current.stages.deblock.enabled=true;current.stages.deband.enabled=true;controller=new VideoController(video,current,report);await controller.start();})();
});
document.querySelector('#stop')!.addEventListener('click',()=>{controller?.dispose();controller=undefined;report({state:'off',message:'全部增强已停止，覆盖画布已移除'});});
document.querySelector('#compare')!.addEventListener('click',()=>{if(controller&&current){current={...current,compare:!current.compare};controller.update(current);}});
document.querySelector('#fullscreen')!.addEventListener('click',()=>void document.querySelector('#player')!.requestFullscreen());
window.addEventListener('pagehide',()=>{controller?.dispose();stream?.getTracks().forEach(t=>t.stop());});

// Record a local A/V baseline once, then play both signals through the same
// HTMLVideoElement. No oscillator is connected directly to the speakers.
let syncUrl:string|undefined;
const syncButton=document.querySelector<HTMLButtonElement>('#sync')!;
syncButton.addEventListener('click',()=>void(async()=>{
  syncButton.disabled=true;controller?.dispose();controller=undefined;
  let audio:AudioContext|undefined,tracks:MediaStream|undefined;
  try{
    report({state:'warming',message:'正在本地生成 6 秒声画测试片，请稍候'});
    audio=new AudioContext();await audio.resume();
    const destination=audio.createMediaStreamDestination();
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const painter=canvas.getContext('2d')!;
    tracks=new MediaStream([...canvas.captureStream(30).getVideoTracks(),...destination.stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp8,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime)throw Error('此浏览器不支持测试片录制');
    const chunks:BlobPart[]=[];const recorder=new MediaRecorder(tracks,{mimeType:mime});
    const recorded=new Promise<Blob>((resolve,reject)=>{recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>reject(Error('测试片录制失败'));recorder.onstop=()=>resolve(new Blob(chunks,{type:mime}));});
    const begin=audio.currentTime+.25;
    for(let i=0;i<6;i++){
      const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.frequency.value=1000;
      gain.gain.setValueAtTime(0,begin+i);gain.gain.linearRampToValueAtTime(.18,begin+i+.003);gain.gain.setValueAtTime(.18,begin+i+.05);gain.gain.linearRampToValueAtTime(0,begin+i+.06);
      oscillator.connect(gain);gain.connect(destination);oscillator.start(begin+i);oscillator.stop(begin+i+.07);
    }
    recorder.start();
    await new Promise<void>(resolve=>{
      function paint(){
        const elapsed=audio!.currentTime-begin,flash=elapsed>=0&&elapsed%1<.1;
        painter.fillStyle=flash?'#fff':'#102030';painter.fillRect(0,0,640,360);
        painter.fillStyle=flash?'#102030':'#fff';painter.font='28px sans-serif';painter.fillText('A/V SYNC: FLASH + BEEP',95,160);painter.fillText(Math.max(0,elapsed).toFixed(2)+' s',255,215);
        if(elapsed<5.8)requestAnimationFrame(paint);else resolve();
      }paint();
    });
    recorder.stop();const blob=await recorded;
    stream?.getTracks().forEach(t=>t.stop());stream=undefined;video.srcObject=null;
    if(syncUrl)URL.revokeObjectURL(syncUrl);syncUrl=URL.createObjectURL(blob);video.src=syncUrl;video.loop=true;video.muted=false;
    await video.play();report({state:'idle',message:'每秒闪白并响一声。先确认原画基线，再运行完整预设比较；此素材用于主观检查，不能替代毫秒级测量。'});
  }catch(error){report({state:'error',message:String(error)});}
  finally{tracks?.getTracks().forEach(t=>t.stop());await audio?.close();syncButton.disabled=false;}
})());
window.addEventListener('pagehide',()=>{if(syncUrl)URL.revokeObjectURL(syncUrl);});
