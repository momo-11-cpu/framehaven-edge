import {read,save,fresh} from './core/storage';
import type {RuntimeStatus} from './core/config';
import {canIssueRenderer,canUseRenderer,type RendererGrant} from './core/renderer-auth';
import {updateLease,type Lease} from './core/lease';
const statuses=new Map<number,Map<number,{status:RuntimeStatus;time:number}>>();
let leaseQueue:Promise<void>=Promise.resolve();
chrome.runtime.onInstalled.addListener(async()=>{
  if(!(await chrome.storage.local.get('preferences')).preferences)await save(fresh());
  await syncScripts();
});
chrome.runtime.onStartup.addListener(()=>void syncScripts());
chrome.permissions.onAdded.addListener(()=>void syncScripts());
chrome.permissions.onRemoved.addListener(()=>void syncScripts());
async function syncScripts(){
  const {origins=[]}=await chrome.permissions.getAll();
  const matches=origins.filter(o=>/^https?:\/\//.test(o));
  const registered=await chrome.scripting.getRegisteredContentScripts();
  const ours=registered.filter(s=>s.id==='framehaven-sites');
  if(ours.length)await chrome.scripting.unregisterContentScripts({ids:ours.map(s=>s.id)});
  if(matches.length)await chrome.scripting.registerContentScripts([{id:'framehaven-sites',js:['content.js'],matches,allFrames:true,runAt:'document_idle',persistAcrossSessions:true}]);
}
chrome.tabs.onRemoved.addListener(tab=>{
  statuses.delete(tab);
  leaseQueue=leaseQueue.then(async()=>{
    const {gpuLease}=await chrome.storage.session.get('gpuLease');
    if((gpuLease as Lease|undefined)?.tab===tab)await chrome.storage.session.remove('gpuLease');
  }).catch(()=>{});
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(!message||typeof message!=='object')return;
  if(message.type==='REPORT'&&sender.tab?.id!==undefined){
    const tabId=sender.tab.id,frame=sender.frameId??0;
    if(!statuses.has(tabId))statuses.set(tabId,new Map());
    statuses.get(tabId)!.set(frame,{status:message.status,time:Date.now()});
    respond({ok:true});return;
  }
  if(message.type==='GET_RUNTIME'&&Number.isInteger(message.tabId)){
    const items=[...(statuses.get(message.tabId)?.values()??[])].filter(v=>Date.now()-v.time<8000);
    const rank=(s:RuntimeStatus)=>['active','degraded','warming','error','unsupported','suspended','off','idle'].indexOf(s.state);
    items.sort((a,b)=>rank(a.status)-rank(b.status));respond(items[0]?.status??{state:'idle',message:'点击“应用到当前页面”开始检测视频'});return;
  }
  if((message.type==='ISSUE_RENDERER'||message.type==='RENDERER_AUTH')&&sender.tab?.id!==undefined){
    const token=String(message.token??'');const tab=sender.tab.id,frame=sender.frameId??0;
    const fromHost=sender.url?.split('#')[0]===chrome.runtime.getURL('renderer.html');
    if(!/^[a-f0-9-]{36}$/.test(token)||(message.type==='ISSUE_RENDERER'&&!/^https?:/.test(sender.url??''))||(message.type==='RENDERER_AUTH'&&!fromHost)){respond({ok:false});return;}
    leaseQueue=leaseQueue.then(async()=>{
      const now=Date.now(),key='rendererGrant_'+token;
      const state=await chrome.storage.session.get(null);const lease=state.gpuLease as Lease|undefined;
      if(message.type==='ISSUE_RENDERER'){
        if(!canIssueRenderer(lease,tab,frame,now)){respond({ok:false});return;}
        const stale=Object.entries(state).filter(([name,value])=>name.startsWith('rendererGrant_')&&((value as RendererGrant).expires<=now||((value as RendererGrant).tab===tab&&(value as RendererGrant).frame===frame))).map(([name])=>name);
        if(stale.length)await chrome.storage.session.remove(stale);
        await chrome.storage.session.set({[key]:{tab,frame,expires:now+120000} satisfies RendererGrant});respond({ok:true});
      }else{
        const grant=state[key] as RendererGrant|undefined;const ok=canUseRenderer(grant,lease,tab,now);
        if(ok)await chrome.storage.session.remove(key);respond({ok});
      }
    }).catch(()=>respond({ok:false}));return true;
  }
  if(message.type==='LEASE'&&sender.tab?.id!==undefined){
    const tab=sender.tab.id,frame=sender.frameId??0;
    leaseQueue=leaseQueue.then(async()=>{
      const {gpuLease}=await chrome.storage.session.get('gpuLease');
      const current=gpuLease as Lease|undefined;
      const result=updateLease(current,{tab,frame,release:message.release===true},Date.now());
      if(result.lease)await chrome.storage.session.set({gpuLease:result.lease});
      else await chrome.storage.session.remove('gpuLease');
      respond({granted:result.granted});
    }).catch(()=>respond({granted:false}));
    return true;
  }
});
