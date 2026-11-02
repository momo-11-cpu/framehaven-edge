import {stages,type Config,type RuntimeStatus,type StageRuntime,type Stage} from './config';
export function stageStates(config:Config,counts:Partial<Record<Stage,number>>,temporal?:{completed:number;detail:string}):Partial<Record<Stage,StageRuntime>>{
  return Object.fromEntries(stages.map(stage=>{
    const enabled=config.mode!=='off'&&config.stages[stage].enabled&&config.stages[stage].strength>0;
    const completed=stage==='interpolation'?temporal?.completed??0:counts[stage]??0;
    return [stage,{state:!enabled?'disabled':completed?'running':'waiting',completed,algorithm:config.stages[stage].algorithm,detail:stage==='interpolation'?temporal?.detail:completed?'累计处理次数，不是屏幕显示帧率':'等待首帧处理完成'}];
  }));
}
export function displayStage(config:Config,status:RuntimeStatus,stage:Stage):StageRuntime{
  if(config.mode==='off'||!config.stages[stage].enabled||config.stages[stage].strength<=0)return {state:'disabled',completed:0};
  if(['error','unsupported','off','suspended','idle','warming'].includes(status.state))return {state:status.state==='error'?'error':status.state==='suspended'?'suspended':'waiting',completed:0,detail:status.message};
  if(status.missing?.includes(stage))return {state:'suspended',completed:status.stages?.[stage]?.completed??0,detail:status.message};
  if(status.stages?.[stage]?.algorithm&&status.stages[stage]!.algorithm!==config.stages[stage].algorithm)return {state:'waiting',completed:0,detail:'正在切换算法，等待新执行记录'};
  if(stage==='interpolation'&&status.interpolationFactor&&status.interpolationFactor!==config.interpolationFactor)return {state:'waiting',completed:0,detail:'正在切换补帧倍率'};
  return status.stages?.[stage]??{state:'waiting',completed:0,detail:'尚未收到此算法的执行统计'};
}
