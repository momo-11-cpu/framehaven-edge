import './style.css';
import {algorithms,capabilities,edit,labels,modeLabels,preset,stages,type Config,type Mode,type RuntimeStatus} from '../core/config';
import {normalize} from '../core/config';
import {displayStage} from '../core/stage-status';
import {choose,fresh,read,save,type Preferences} from '../core/storage';
import {version} from '../../package.json';
const app=document.querySelector<HTMLDivElement>('#app')!;
const preview=typeof chrome==='undefined'||!chrome.storage?.local;
let preferences=preview?fresh():await read();
let config:Config=preferences.config;
let tab:chrome.tabs.Tab|undefined;
let status:RuntimeStatus={state:'idle',message:preview?'界面预览。使用本地测试播放器可验证 GPU 处理':'正在连接当前页面'};
let origin='';let siteEnabled=false;
if(!preview){
  [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  try{const url=new URL(tab?.url??'');if(['http:','https:'].includes(url.protocol))origin=url.origin;}catch{}
  if(origin&&preferences.sites[origin])config=normalize(preferences.sites[origin]);
  if(origin)siteEnabled=await chrome.permissions.contains({origins:[`${origin}/*`]});
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,cls?:string){
  const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;
}
async function commit(next:Config){
  config=next;preferences.config=next;
  if(origin&&preferences.sites[origin])preferences.sites[origin]=next;
  if(next.mode!=='off')preferences.snapshots[next.mode]=next;
  try{if(!preview)await save(preferences);render();}catch(error){status={state:'error',message:`保存失败：${String(error)}`};render();}
}
function render(){
  app.replaceChildren();
  const header=element('header');
  const brand=element('div',undefined,'brand');brand.append(element('span','帧','brandmark'),element('h1','帧境'));
  const versionLabel=element('span',`版本 ${version}`,'version');header.append(brand,versionLabel);app.append(header);
  const intro=element('p','让每一帧，更接近你喜欢的样子。','intro');app.append(intro);
  const modes=element('div',undefined,'modes');modes.setAttribute('role','group');modes.setAttribute('aria-label','画质模式');
  for(const mode of ['off','live','anime','custom'] as Mode[]){
    const button=element('button',modeLabels[mode],config.mode===mode?'selected':'');
    button.type='button';button.setAttribute('aria-pressed',String(config.mode===mode));
    button.onclick=async()=>{preferences.config=config;preferences=choose(preferences,mode);await commit(preferences.config);};modes.append(button);
  }
  app.append(modes);
  const state=element('section',undefined,`status ${status.state}`);
  state.append(element('span','', 'status-dot'));
  const text=element('div');const stateNames:Record<string,string>={idle:'等待视频',off:'原生播放',warming:'正在准备',active:'增强运行中',degraded:'部分增强运行中',unsupported:'当前路径不可用',error:'已恢复原画',suspended:'增强已暂停'};
  text.append(element('strong',stateNames[status.state]),element('p',status.message));state.append(text);state.setAttribute('aria-live','polite');app.append(state);
  const stats=element('div',undefined,'stats');
  const metrics=[['视频',status.source??'—'],['呈现帧率',status.outputFps?`${status.outputFps.toFixed(1)} fps`:'—'],['帧对处理耗时',status.processingMs?`${status.processingMs.toFixed(1)} ms`:'—']];
  for(const [label,value]of metrics){const cell=element('div');cell.append(element('span',label),element('strong',value));stats.append(cell);}app.append(stats);
  const diagnostics=element('p',`源帧 ${status.sourceFps?.toFixed(1)??'—'} fps · 补帧呈现 ${status.generatedFps?.toFixed(1)??'—'} fps · 页面刷新约 ${status.displayHz?.toFixed(0)??'—'} Hz\n迟到 ${status.lateFrames??0} · 显示丢弃 ${status.displayDropped??0} · 忙碌跳过 ${status.busyPairs??0}`,'stage-status');app.append(diagnostics);
  const section=element('section',undefined,'controls');
  const heading=element('div',undefined,'section-heading');heading.append(element('h2','画质处理'));
  const reset=element('button','恢复默认','text-button');reset.onclick=()=>void commit(preset(config.mode));heading.append(reset);section.append(heading);
  const plan=capabilities(config);
  for(const stage of stages){
    const setting=config.stages[stage];const row=element('div',undefined,'control-row');
    const title=element('label',undefined,'row-title');const name=element('span',labels[stage]);title.append(name);
    const input=element('input');input.type='checkbox';input.checked=setting.enabled;input.setAttribute('aria-label',`${labels[stage]}开关`);
    input.onchange=()=>void commit(edit(config,stage,{enabled:input.checked}));title.append(input);row.append(title);
    const bottom=element('div',undefined,'row-detail');
    const select=element('select');select.setAttribute('aria-label',`${labels[stage]}算法`);
    for(const algorithm of algorithms.filter(a=>a.stage===stage)){
      const option=element('option',algorithm.label+(algorithm.ready?'':' · 未就绪'));option.value=algorithm.id;option.selected=algorithm.id===setting.algorithm;
      // A current unavailable preset choice remains visible; it cannot be used to imply running.
      option.disabled=!algorithm.ready&&algorithm.id!==setting.algorithm;select.append(option);
    }
    select.disabled=config.mode==='off';select.onchange=()=>void commit(edit(config,stage,{algorithm:select.value}));bottom.append(select);
    const chosen=algorithms.find(a=>a.id===setting.algorithm)!;
    const actual=displayStage(config,status,stage);
    const stateLabels={running:'运行中',waiting:'等待执行',disabled:'已关闭',suspended:'已暂停',error:'运行异常'};
    const badge=element('span',stateLabels[actual.state],actual.state==='running'?'badge':'badge pending');bottom.append(badge);row.append(bottom);
    const execution=element('p',actual.state==='running'?`GPU 已完成 ${actual.completed.toLocaleString()} 帧次${actual.detail?' · '+actual.detail:''}`:actual.detail??stateLabels[actual.state],'stage-status');row.append(execution);
    if(stage==='interpolation'){
      const factorLabel=element('label',undefined,'factor-row');factorLabel.append(element('span','补帧倍率'));
      const factor=element('select');factor.setAttribute('aria-label','补帧倍率');
      for(const n of [2,4] as const){const option=element('option',`${n}×`);option.value=String(n);option.selected=config.interpolationFactor===n;factor.append(option);}
      factor.disabled=config.mode==='off'||!setting.enabled;factor.onchange=()=>void commit({...config,interpolationFactor:factor.value==='4'?4:2});factorLabel.append(factor);row.append(factorLabel);
      row.append(element('p','2× 每对源帧补 1 帧；4× 补 3 帧并复用公共计算。实际呈现受屏幕刷新速率与整链负载限制。','hint'));
    }
    if(stage==='sharpen'&&setting.enabled&&config.mode!=='off'){
      const range=element('input');range.type='range';range.min='0';range.max='100';range.value=String(Math.round(setting.strength*100));range.setAttribute('aria-label','锐化强度');
      const rangeLabel=element('div',undefined,'range-label');const output=element('output',`${range.value}%`);rangeLabel.append(element('span','强度'),output);row.append(rangeLabel,range);
      range.oninput=()=>output.textContent=`${range.value}%`;range.onchange=()=>void commit(edit(config,stage,{strength:Number(range.value)/100}));
    }
    if(chosen.note&&setting.enabled)row.append(element('p',chosen.note,'hint'));
    section.append(row);
  }
  app.append(section);
  const help=element('p',config.mode==='live'||config.mode==='anime'?'预设固定补帧、锐化与 AI 放大；修改核心项会转为自定义。':'自定义可组合已就绪的算法；未完成模型不会被其他效果替代。','hint');app.append(help);
  const compare=element('label',undefined,'setting-row');const cmp=element('input');cmp.type='checkbox';cmp.checked=config.compare;cmp.disabled=config.mode==='off';cmp.onchange=()=>void commit({...config,compare:cmp.checked});compare.append(element('span','左右对比原画'),cmp);app.append(compare);
  const apply=element('button',preview?'界面预览':'应用到当前页面','primary');apply.disabled=preview||!origin;apply.onclick=()=>void applyCurrent();app.append(apply);
  const site=element('button',siteEnabled?'取消此站自动运行':'允许此站自动运行','secondary');site.disabled=preview||!origin;site.onclick=()=>void toggleSite();app.append(site);
  const footer=element('footer');footer.append(element('span','本地处理 · 不上传视频'));
  const settings=element('button','更多设置','text-button');settings.onclick=()=>{if(!preview)void chrome.runtime.openOptionsPage();};footer.append(settings);app.append(footer);
  if(document.body.classList.contains('options')){
    const details=element('section',undefined,'about');details.append(element('h2','关于当前版本'),element('p','真人与动画共用 Framegen v7s，支持 2× / 4×。逐项状态来自 GPU 完成记录，不再用算法支持标记代替运行状态。帧次表示处理次数，不代表屏幕实际显示次数。'),element('p','原生视频控件、视频元素独立全屏、原生画中画、受保护内容及不允许读取的跨域视频会保留原画。'));
    const diagnostic=element('button','导出本地诊断','secondary');diagnostic.onclick=()=>{
      const data={version,time:new Date().toISOString(),config,status,origin:origin?new URL(origin).hostname:''};
      const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=element('a');a.href=url;a.download='framehaven-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };details.append(diagnostic);
    const webnn=element('a','1080p 加速测试','text-button');webnn.href='./model-lab.html';webnn.target='_blank';webnn.rel='noopener';details.append(webnn);app.append(details);
  }
}
async function applyCurrent(){
  if(tab?.id===undefined)return;
  status={state:'warming',message:'正在检测当前页面的视频'};render();
  try{
    await save(preferences);
    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']});
    await poll();
  }catch(error){status={state:'error',message:`页面连接失败：${error instanceof Error?error.message:String(error)}`};render();}
}
async function toggleSite(){
  if(!origin)return;
  try{
    if(siteEnabled){await chrome.permissions.remove({origins:[`${origin}/*`]});delete preferences.sites[origin];siteEnabled=false;await save(preferences);}
    else{
      const granted=await chrome.permissions.request({origins:[`${origin}/*`]});
      if(!granted)return;siteEnabled=true;preferences.sites[origin]=config;await save(preferences);await applyCurrent();
    }
    render();
  }catch(error){status={state:'error',message:`站点设置失败：${String(error)}`};render();}
}
async function poll(){
  if(preview||tab?.id===undefined)return;
  try{
    status=await chrome.runtime.sendMessage({type:'GET_RUNTIME',tabId:tab.id});
    // Do not replace a focused input/select while the user is adjusting it.
    if(!['INPUT','SELECT'].includes(document.activeElement?.tagName??''))render();
  }catch{}
}
render();if(!preview){void poll();setInterval(()=>void poll(),1800);}
