import './demo.css';
import {benchmarkFramegen} from './engine/framegen-benchmark';
const button=document.querySelector<HTMLButtonElement>('#run')!,status=document.querySelector('#result')!,log=document.querySelector('#log')!;
let reportUrl:string|undefined;
button.addEventListener('click',()=>void(async()=>{
  button.disabled=true;
  try{
    const report=await benchmarkFramegen(new URL('./',location.href),s=>status.textContent=s);
    log.textContent=JSON.stringify(report,null,2);status.textContent='两种模式及 2× / 4× 合成场景测试完成；实际视频流畅度和音画同步仍需播放验证。';
    if(reportUrl)URL.revokeObjectURL(reportUrl);
    const link=document.createElement('a');link.textContent='保存测试报告';link.download='framehaven-1.0.0-framegen.json';
    reportUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));link.href=reportUrl;status.append(' ',link);
  }catch(error){status.textContent='测试失败';log.textContent=String(error);}finally{button.disabled=false;}
})());
