export function fitRect(box:{width:number;height:number},source:{width:number;height:number},fit:string,position='50% 50%'){
  if(!source.width||!source.height||!box.width||!box.height)throw Error('视频尺寸尚未就绪');
  if(!['contain','fill','scale-down','none'].includes(fit))throw Error('此版本暂不支持裁剪式视频布局');
  const parts=position.split(/\s+/);
  const values=parts.length===1?[parts[0],'50%']:parts;
  const keywords:Record<string,string>={left:'0%',top:'0%',center:'50%',right:'100%',bottom:'100%'};
  const fractions=values.map(v=>keywords[v]??v).map(v=>{
    if(!/^\d+(\.\d+)?%$/.test(v))throw Error('此版本暂不支持像素偏移的视频布局');
    return Number.parseFloat(v)/100;
  });
  let width=box.width,height=box.height;
  if(fit!=='fill'){
    let scale=fit==='none'?1:Math.min(box.width/source.width,box.height/source.height);
    if(fit==='scale-down')scale=Math.min(1,scale);
    width=source.width*scale;height=source.height*scale;
  }
  if(width>box.width+.1||height>box.height+.1)throw Error('视频画面裁剪暂不支持');
  return {left:(box.width-width)*fractions[0],top:(box.height-height)*fractions[1],width,height};
}
