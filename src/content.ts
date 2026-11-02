import {VideoController} from './engine/controller';
import {read} from './core/storage';
import {capabilities,normalize,type Config,type RuntimeStatus} from './core/config';
const root=globalThis as typeof globalThis&{__framehaven?:{refresh:()=>Promise<void>}};
if(location.protocol==='chrome-extension:'){/* Rendering hosts are managed by their parent controller. */}
else if(root.__framehaven){void root.__framehaven.refresh();}
else {
  let controller:VideoController|undefined;
  let selected:HTMLVideoElement|undefined;
  let config:Config;
  let lastStatus:RuntimeStatus={state:'idle',message:'正在发现视频'};
  let refreshing=false,disposed=false;
  let leaseGranted=false;
  let leaseDeadline=0;
  let failed=false;
  let lastVideoReady=false;
  let blocked=false;
  let previousSource='';
  const report=(status:RuntimeStatus)=>{
    lastStatus=status;
    if(status.state==='error'||status.state==='unsupported'||status.state==='suspended'){
      blocked=true;
      try{void chrome.runtime.sendMessage({type:'LEASE',release:true}).catch(()=>{});}catch{}
    }
    try{void chrome.runtime.sendMessage({type:'REPORT',status}).catch(()=>teardown());}catch{teardown();}
  };
  function videos(node:Document|ShadowRoot):HTMLVideoElement[]{
    const result=[...node.querySelectorAll('video')];
    for(const element of node.querySelectorAll('*'))if(element.shadowRoot)result.push(...videos(element.shadowRoot));
    return result;
  }
  function select(){
    return videos(document).filter(v=>{const r=v.getBoundingClientRect();return r.width>100&&r.height>60&&r.bottom>0&&r.top<innerHeight;})
      .sort((a,b)=>{const area=(v:HTMLVideoElement)=>{const r=v.getBoundingClientRect();return r.width*r.height*(v.paused?1:2);};return area(b)-area(a);})[0];
  }
  async function refresh(force=false){
    if(refreshing||disposed)return;refreshing=true;
    try{
      const p=await read();
      const site=p.sites[location.origin];
      const next=normalize(site??p.config);
      const changed=JSON.stringify(next)!==JSON.stringify(config);config=next;
      const video=select();
      const source=video?.currentSrc??'';
      if(changed||force||video!==selected||source!==previousSource){blocked=false;failed=false;}
      previousSource=source;
      if(document.hidden||config.mode==='off'||!video){
        controller?.dispose();controller=undefined;selected=undefined;leaseGranted=false;
        await chrome.runtime.sendMessage({type:'LEASE',release:true});
        report({state:config.mode==='off'?'off':document.hidden?'suspended':'idle',message:config.mode==='off'?'所有增强已关闭，原生播放':document.hidden?'后台标签页已暂停增强':'未发现可处理的视频'});return;
      }
      if(blocked){report(lastStatus);return;}
      if(capabilities(config).active.length===0){
        selected=video;controller?.dispose();controller=undefined;
        report({state:'unsupported',message:'所选算法尚未就绪，已保留原生播放'});return;
      }
      const permission=await chrome.runtime.sendMessage({type:'LEASE'});
      if(!permission?.granted){
        controller?.dispose();controller=undefined;selected=undefined;leaseGranted=false;
        report({state:'suspended',message:'其他页面正在使用 GPU 增强，当前保留原生播放'});return;
      }
      leaseGranted=true;
      // Stop local submissions before the worker lease can expire or be taken over.
      leaseDeadline=performance.now()+4000;
      const ready=video.readyState>=2&&video.videoWidth>0;
      if(video!==selected||!controller){
        controller?.dispose();selected=video;controller=new VideoController(video,config,report,()=>leaseGranted&&performance.now()<leaseDeadline);lastVideoReady=ready;void controller.start();
      }else if(force||changed||ready!==lastVideoReady){lastVideoReady=ready;controller.update(config);}
      else report(lastStatus);
    }catch(error){if(!failed){failed=true;report({state:'error',message:error instanceof Error?error.message:'页面检测失败'});}}
    finally{refreshing=false;}
  }
  const timer=setInterval(()=>void refresh(),2000);
  const onVisibility=()=>{if(document.hidden){controller?.dispose();controller=undefined;selected=undefined;}void refresh();};
  document.addEventListener('visibilitychange',onVisibility);
  const storageListener=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local'&&changes.preferences)void refresh();};chrome.storage.onChanged.addListener(storageListener);
  const onMessage=(message:{type?:string},_sender:chrome.runtime.MessageSender,respond:(value:unknown)=>void)=>{
    if(message?.type==='STATUS'){respond(lastStatus);return;}
    if(message?.type==='REFRESH'){void refresh(true);respond({ok:true});}
  };
  chrome.runtime.onMessage.addListener(onMessage);
  function teardown(){
    if(disposed)return;disposed=true;clearInterval(timer);controller?.dispose();
    document.removeEventListener('visibilitychange',onVisibility);
    chrome.storage.onChanged.removeListener(storageListener);chrome.runtime.onMessage.removeListener(onMessage);
    delete root.__framehaven;
  }
  window.addEventListener('pagehide',()=>{
    controller?.dispose();controller=undefined;selected=undefined;
    if(leaseGranted)void chrome.runtime.sendMessage({type:'LEASE',release:true}).catch(()=>{});
  });
  root.__framehaven={refresh:()=>refresh(true)};void refresh();
}
