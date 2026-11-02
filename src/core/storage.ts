import { normalize,preset, type Config,type Mode } from './config';
export interface Preferences { version:1; config:Config; snapshots:Partial<Record<Mode,Config>>; sites:Record<string,Config> }
export function fresh():Preferences {return {version:1,config:preset(),snapshots:{},sites:{}};}
export async function read():Promise<Preferences>{
  const raw=(await chrome.storage.local.get('preferences')).preferences as Partial<Preferences>|undefined;
  return {version:1,config:normalize(raw?.config),snapshots:raw?.snapshots??{},sites:raw?.sites??{}};
}
export function choose(p:Preferences,mode:Mode):Preferences {
  const next=structuredClone(p);
  if(next.config.mode!=='off')next.snapshots[next.config.mode]=next.config;
  next.config=mode==='off'?preset('off'):normalize(next.snapshots[mode]??preset(mode));
  return next;
}
export async function save(p:Preferences){await chrome.storage.local.set({preferences:p});}
