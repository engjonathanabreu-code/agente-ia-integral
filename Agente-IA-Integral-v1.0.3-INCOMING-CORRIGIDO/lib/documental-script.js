const LIMIT=30*1024*1024;
export const scriptConfigured=()=>!!(process.env.GOOGLE_DRIVE_SCRIPT_URL&&/^[a-f0-9]{64}$/.test(process.env.GOOGLE_DRIVE_SCRIPT_SECRET||''));
export function scriptURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.hostname!=='script.google.com'||u.username||u.password||u.port||u.search||u.hash||!/^\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(u.pathname))throw new Error('drive_script_url_invalida');return u;}
async function boundedJSON(r){
 if(Number(r.headers.get('content-length')||0)>LIMIT)throw new Error('drive_script_resposta_excessiva');
 const reader=r.body.getReader();let size=0,chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw new Error('drive_script_resposta_excessiva');}chunks.push(Buffer.from(value));}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function scriptOperation(op,data){
 if(!scriptConfigured())throw new Error('drive_script_nao_configurado');
 let url=scriptURL(process.env.GOOGLE_DRIVE_SCRIPT_URL),method='POST',body=JSON.stringify({...data,key:process.env.GOOGLE_DRIVE_SCRIPT_SECRET,op});
 for(let i=0;i<4;i++){
  const r=await fetch(url,{method,redirect:'manual',...(body?{body,headers:{'Content-Type':'application/json'}}:{}),signal:AbortSignal.timeout(45000)});
  if([301,302,303].includes(r.status)){
   const next=new URL(r.headers.get('location'),url);
   if(next.protocol!=='https:'||next.hostname!=='script.googleusercontent.com'||next.username||next.password||next.port)throw new Error('drive_script_redirecionamento_recusado');
   url=next;method='GET';body=undefined;continue;
  }
  if(!r.ok)throw new Error('drive_script_indisponivel');
  const result=await boundedJSON(r);if(result?.ok!==true||!result.data)throw new Error('drive_script_operacao_recusada');return result.data;
 }
 throw new Error('drive_script_redirecionamento_excessivo');
}
export function scriptReadOperation(path,options={}){
 const u=new URL(path,'https://www.googleapis.com/drive/v3/');
 if(u.origin!=='https://www.googleapis.com'||options.method&&options.method!=='GET'||options.body)throw new Error('drive_script_operacao_invalida');
 if(u.pathname==='/drive/v3/files'){
  const match=(u.searchParams.get('q')||'').match(/^'([A-Za-z0-9_-]{10,200})' in parents and trashed = false$/);
  if(!match)throw new Error('drive_script_consulta_invalida');
  return {op:'list',data:{folder:match[1],pageToken:u.searchParams.get('pageToken')||''}};
 }
 const id=u.pathname.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]{10,200})$/)?.[1];if(!id)throw new Error('drive_script_operacao_invalida');
 return {op:options.binary?'download':'meta',data:{id}};
}
