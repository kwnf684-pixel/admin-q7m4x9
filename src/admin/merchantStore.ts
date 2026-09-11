import {useSyncExternalStore} from 'react';
import {client,ref} from '../cloud/client';
import {getSession} from '../data/localAccess';
export type Merchant={id:string;name:string;whatsapp:string;subscriptionDays:number;startsAt:string;expiresAt:string;frozen:boolean};
type Snapshot={rows:Merchant[];loading:boolean;error:string;online:boolean};
let snapshot:Snapshot={rows:[],loading:true,error:'',online:navigator.onLine};
const listeners=new Set<()=>void>();let stop:(()=>void)|undefined;let watchedToken:string|undefined;
function publish(patch:Partial<Snapshot>){snapshot={...snapshot,...patch};listeners.forEach(fn=>fn());}
function connectionError(error:unknown){return error instanceof Error?error.message:'تعذر الاتصال بالسحابة. حاول مجددًا.';}
function watch(){
 stop?.();stop=undefined;const token=getSession()?.token;
 if(!navigator.onLine){publish({online:false,loading:false,error:'لا يوجد اتصال بالإنترنت. إدارة التجار تتطلب الاتصال بالسحابة.'});return;}
 if(!client||!token){publish({rows:[],online:true,loading:false,error:'اتصال الإدارة غير جاهز. أعد تسجيل الدخول.'});return;}
 publish({...(token!==watchedToken?{rows:[]}:{}),online:true,loading:true,error:''});watchedToken=token;
 const query=client.watchQuery(ref<'query'>('merchants:list'),{token});const update=()=>{try{const rows=query.localQueryResult() as Merchant[]|undefined;if(rows)publish({rows,loading:false,error:''});}catch(error){publish({loading:false,error:connectionError(error)});}};stop=query.onUpdate(update);update();
}
function subscribe(fn:()=>void){listeners.add(fn);if(listeners.size===1)watch();return()=>{listeners.delete(fn);if(!listeners.size){stop?.();stop=undefined;}};}
export function useMerchants(){return useSyncExternalStore(subscribe,()=>snapshot);}
window.addEventListener('offline',()=>{stop?.();stop=undefined;publish({online:false,loading:false,error:'لا يوجد اتصال بالإنترنت. البيانات المعروضة آخر نسخة مستلمة؛ التعديل غير متاح.'});});
window.addEventListener('online',()=>{if(listeners.size)watch();});
export function retryMerchants(){watch();}
function connection(){const token=getSession()?.token;if(!navigator.onLine)throw Error('الاتصال بالإنترنت مطلوب لتنفيذ العملية.');if(!client||!token)throw Error('أعد تسجيل الدخول إلى الإدارة.');return {cloud:client,token};}
export function normalizePhone(value:string){let phone=value.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[\s()+-]/g,'');if(/^07\d{9}$/.test(phone))phone='964'+phone.slice(1);if(phone.startsWith('00'))phone=phone.slice(2);return phone;}
export async function saveMerchant(id:string|null,input:{name:string;whatsapp:string;password:string;days:string;renew?:boolean}){
 const name=input.name.trim(),whatsapp=normalizePhone(input.whatsapp),days=Number(input.days);
 if(!name)throw Error('اسم التاجر مطلوب.');if(!/^[1-9]\d{7,14}$/.test(whatsapp))throw Error('أدخل رقم واتساب صحيحًا مع رمز الدولة، أو رقمًا عراقيًا يبدأ بـ 07.');if(!Number.isInteger(days)||days<1||days>3650)throw Error('أدخل عدد أيام من 1 إلى 3650.');
 if((!id||input.password)&&input.password.length<4)throw Error('كلمة المرور يجب ألا تقل عن 4 أحرف أو أرقام.');
 const {cloud,token}=connection();await cloud.action(ref<'action'>('merchants:save'),{token,...(id?{id}:{}),name,whatsapp,password:input.password,days,renew:input.renew===true});
}
export async function deleteMerchant(id:string,code:string){if(!code.trim())throw Error('أدخل رمز تأكيد الحذف.');const {cloud,token}=connection();await cloud.mutation(ref<'mutation'>('merchants:remove'),{token,id,code:code.trim().replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))});publish({rows:snapshot.rows.filter(r=>r.id!==id)});retryMerchants();}
export async function freezeMerchant(id:string,frozen:boolean){const {cloud,token}=connection();await cloud.mutation(ref<'mutation'>('merchants:freeze'),{token,id,frozen});}
export function subscriptionStatus(merchant:Pick<Merchant,'expiresAt'>&Partial<Pick<Merchant,'subscriptionDays'>>,now=Date.now()){
 const expires=Date.parse(merchant.expiresAt),day=86400000,elapsed=now-expires;
 return {remaining:Math.min(merchant.subscriptionDays??Infinity,Math.max(0,Math.ceil(-elapsed/day))),overdue:elapsed>=day,lateDays:Math.max(0,Math.floor(elapsed/day)),inGrace:elapsed>=0&&elapsed<3*day,graceRemaining:elapsed>=0?Math.max(0,Math.ceil((3*day-elapsed)/day)):3,graceEnded:elapsed>=3*day};
}
export function reminderLink(merchant:Pick<Merchant,'name'|'whatsapp'|'expiresAt'>){const remaining=subscriptionStatus(merchant).remaining;const message=`مرحبًا ${merchant.name}، ${remaining?`يتبقى ${remaining} يوم على انتهاء اشتراكك`:'انتهى اشتراكك'} في أعمال المستقبل. هل ترغب بتجديد الاشتراك أم تواجه مشكلة؟ نحن هنا لمساعدتك.`;return `https://wa.me/${merchant.whatsapp}?text=${encodeURIComponent(message)}`;}
