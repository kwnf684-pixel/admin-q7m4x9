import {client,ref} from '../cloud/client';
export type CloudSession={token:string;merchantId:string;name:string;expiresAt:number;sessionExpiresAt:number;role:'admin'|'merchant';offlineUntil:number};
const role='admin' as CloudSession['role'];
const key='almustaqbal-admin-cloud-session-v1';
const listeners=new Set<()=>void>();
let session:CloudSession|null=null;
let checked=false;
let failure='';
try{const raw=localStorage.getItem(key);if(raw){const s=JSON.parse(raw);if(typeof s.token==='string'&&s.role===role&&Number.isFinite(s.offlineUntil)&&Number.isFinite(s.sessionExpiresAt))session=s;}}catch{failure='تعذر قراءة جلسة الدخول المحفوظة.';}
let version=0;export const accessVersion=()=>version;const emit=()=>{version++;listeners.forEach(fn=>fn());};
export function getSession(){return session;}
export function accessError(){return failure;}
export function subscribeAccess(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
export function isUnlocked(){return !!session&&(checked||!navigator.onLine&&role==='merchant')&&Date.now()<session.sessionExpiresAt&&(role==='admin'||Date.now()<session.offlineUntil);}
function persist(next:CloudSession|null){if(next)localStorage.setItem(key,JSON.stringify(next));else localStorage.removeItem(key);session=next;emit();}
export async function loginLocal(phone:string,password:string){if(!client)throw Error('لم يتم ضبط اتصال الخادم.');const result=await client.action(ref<'action'>('auth:login'),{role,phone,password}) as Omit<CloudSession,'offlineUntil'>;checked=true;failure='';persist({...result,offlineUntil:Math.min(Date.now()+86400000,result.sessionExpiresAt,result.expiresAt+3*86400000)});watchSession();return true;}
let unwatch:(()=>void)|undefined;
function stopWatching(){const stop=unwatch;unwatch=undefined;stop?.();}
function watchSession(){stopWatching();if(!client||!session)return;const token=session.token;const watch=client.watchQuery(ref<'query'>('access:status'),{token});unwatch=watch.onUpdate(()=>{try{const result=watch.localQueryResult();if(result===undefined)return;checked=true;if(result.status!=='active'){failure=result.status==='frozen'?'الحساب مجمّد. تواصل مع الإدارة.':result.status==='deleted'?'تم حذف الحساب بواسطة الإدارة.':'انتهت الجلسة أو مهلة الاشتراك. تواصل مع الإدارة.';if(result.status==='deleted'&&session)window.dispatchEvent(new CustomEvent('tenant-deleted',{detail:session.merchantId}));persist(null);stopWatching();return;}if(session?.token===token)persist({...session,...result,token,offlineUntil:Math.min(Date.now()+86400000,result.sessionExpiresAt,result.expiresAt+3*86400000)});}catch{failure='تعذر التحقق من الحساب. تحقق من اتصالك.';emit();}});}
export async function logoutLocal(){const previous=session;persist(null);checked=false;stopWatching();if(client&&previous)try{await client.mutation(ref<'mutation'>('access:logout'),{token:previous.token});}catch{/* Session expires server-side; this device is signed out. */}}
export async function revokeSession(){persist(null);checked=false;stopWatching();}
export async function changeLocalPassword(current:string,next:string){if(!client||!session)throw Error('سجّل الدخول أولًا.');await client.action(ref<'action'>('auth:changePassword'),{token:session.token,current,password:next});return true;}
export function subscriptionEnd(){return session?new Date(session.expiresAt).toISOString():'';}
export function subscriptionRemaining(){return session?Math.max(0,Math.ceil((session.expiresAt-Date.now())/86400000)):null;}
watchSession();
window.addEventListener('storage',e=>{if(e.key===key){try{const next=e.newValue?JSON.parse(e.newValue):null;if(next?.token===session?.token){session=next;emit();return;}session=next;checked=false;watchSession();emit();}catch{session=null;emit();}}});
window.addEventListener('online',()=>{watchSession();emit();});
window.addEventListener('offline',emit);
setInterval(emit,30000);
