import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.css':'text/css','.json':'application/json','.png':'image/png','.wgsl':'text/plain'};
createServer(async(req,res)=>{
  try {
    const file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!file.startsWith(root+sep)) {res.writeHead(403);res.end();return;}
    res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');
    res.end(await readFile(file));
  }catch {res.writeHead(404);res.end('Not found');}
}).listen(5173,'127.0.0.1',()=>console.log('Preview http://127.0.0.1:5173/demo.html'));
