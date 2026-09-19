import {NextRequest,NextResponse} from 'next/server';
import {AppError,authenticate,login,mutate,state,tokenHash} from '@/lib/service';
import {isDemo,transaction} from '@/lib/store';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookieName='onshift_session';
const attempts=new Map<string,{count:number;until:number}>();
function response(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','Vary':'Cookie'}});}
async function handle(request:NextRequest){try{
 const endpoint=request.nextUrl.pathname.slice('/api/'.length);const token=request.cookies.get(cookieName)?.value;
 if(request.method==='GET'&&endpoint==='config')return response({demo:isDemo(),sampleLogin:process.env.ENABLE_SAMPLE_LOGIN==='true'||(isDemo()&&!process.env.VERCEL)});
 if(request.method==='GET'){if(endpoint!=='state')throw new AppError('찾을 수 없습니다.',404);return response(await transaction(s=>({...state(s,authenticate(s,token),request.nextUrl.searchParams),demo:isDemo()})));}
 const origin=request.headers.get('origin');const expected=process.env.APP_ORIGIN??request.nextUrl.origin;if(origin!==expected)throw new AppError('요청 출처를 확인할 수 없습니다.',403);
 if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError('JSON 요청이 필요합니다.',415);
 const raw=await request.text();if(raw.length>16384)throw new AppError('요청이 너무 큽니다.',413);let body:Record<string,unknown>;try{body=JSON.parse(raw);if(!body||Array.isArray(body)||typeof body!=='object')throw new Error();}catch{throw new AppError('입력 내용을 확인해 주세요.');}
 if(endpoint==='login'){
 const key=String(body.username??'').toLowerCase();const now=Date.now();const attempt=attempts.get(key);if(attempt&&attempt.until>now&&attempt.count>=10)throw new AppError('잠시 후 다시 로그인해 주세요.',429);attempts.set(key,{count:attempt&&attempt.until>now?attempt.count+1:1,until:now+15*60000});if(attempts.size>10000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
 const result=await transaction(s=>login(s,body));attempts.delete(key);const res=response({ok:true,user:result.user});res.cookies.set(cookieName,result.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:7*86400});return res;
 }
 const result=await transaction(s=>{const user=authenticate(s,token);if(endpoint==='logout'){s.sessions=s.sessions.filter(x=>x.id!==tokenHash(token!));return {ok:true};}return mutate(s,user,endpoint,body);});const res=response(result);if(endpoint==='logout'||endpoint==='password')res.cookies.delete(cookieName);return res;
 }catch(error){if(error instanceof AppError)return response({error:error.message},error.status);console.error('API request failed',error instanceof Error?error.message:'unknown');return response({error:'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'},500);}}
export const GET=handle;
export const POST=handle;
