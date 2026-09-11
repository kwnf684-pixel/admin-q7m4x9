import {query,mutation} from './model';
import {v,ConvexError} from 'convex/values';
import {session,digest} from './access';
const collections=['customers','transfers','rates','rateLog','cash','exchange','wallets','inventory','inventoryCustomers','inventorySales'];
const change=v.object({collection:v.string(),id:v.string(),value:v.any(),baseVersion:v.number()});
function validTree(value:unknown,depth=0):boolean{if(depth>12)return false;if(value===null||typeof value==='boolean')return true;if(typeof value==='number')return Number.isFinite(value);if(typeof value==='string')return value.length<=16000;if(Array.isArray(value))return value.length<=1500&&value.every(x=>validTree(x,depth+1));if(typeof value==='object')return Object.entries(value).length<=100&&Object.entries(value).every(([k,x])=>!['__proto__','constructor','prototype'].includes(k)&&validTree(x,depth+1));return false;}
function validate(collection:string,id:string,value:unknown){
 const fail=()=>{throw new ConvexError('INVALID_DATA');};
 if(!collections.includes(collection)||!id||id.length>160||!validTree(value))fail();if(value===null)return;
 if(typeof value!=='object'||Array.isArray(value))fail();
 const r=value as Record<string,unknown>;
 if(collection==='rateLog'&&id==='history'){
 if(!Array.isArray(r.rows))return fail();for(const row of r.rows){if(!row||typeof row!=='object'||typeof row.id!=='string')return fail();validate('rates',row.id,row);}return;
 }
 if(r.id!==id)fail();
 const strings:Record<string,string[]>={
 customers:['name','phone','address','notes','created','updated','lastActivity'],
 transfers:['date','sender','recipient','currency','status','direction','office','senderPhone','recipientPhone','senderAddress','recipientAddress','notes','reason','voucher','deliveredAt'],
 rates:['base','counter','name','user','updated','notes'],rateLog:['base','counter','name','user','updated','notes'],
 cash:['date','party','currency','type','partyType','reason','reference','description','notes'],
 exchange:['date','party','currency','counter','type','status','box','user','description','notes'],inventorySales:['customerId','customerName','date','currency'],inventoryCustomers:['name','phone','details'],inventory:['name'],wallets:['name']};
 const numbers:Record<string,string[]>={customers:[],transfers:['amount','commission'],rates:['buy','sell'],rateLog:['buy','sell'],cash:['amount'],exchange:['amount','rate','commission','counterpart'],inventorySales:['total'],inventoryCustomers:[],inventory:['quantity','purchasePrice','salePrice'],wallets:['balance']};
 if(!strings[collection].every(k=>typeof r[k]==='string')||!numbers[collection].every(k=>typeof r[k]==='number'&&Number.isFinite(r[k])))fail();
 const text=(k:string)=>typeof r[k]==='string'&&r[k].trim().length>0;
 const numeric=(k:string,min:number,max=Infinity,exclusive=false)=>typeof r[k]==='number'&&Number.isFinite(r[k])&&(exclusive?r[k]>min:r[k]>=min)&&r[k]<=max;
 const date=(k:string)=>typeof r[k]==='string'&&Number.isFinite(Date.parse(r[k]));
 const currency=(k:string)=>text(k)&&!['__proto__','constructor','prototype'].includes(String(r[k]));
 const enumeration=(k:string,options:string[])=>typeof r[k]==='string'&&options.includes(r[k]);
 if(collection==='customers'){
 if(!text('name')||typeof r.active!=='boolean'||!date('created')||!date('updated')||!r.balances||typeof r.balances!=='object'||Array.isArray(r.balances)||!Object.entries(r.balances).every(([code,x])=>code.trim()&&typeof x==='number'&&Number.isFinite(x)))fail();
 // Opening balances may exceed an edited current balance because accumulated cash is deducted by the frontend.
 }
 if(collection==='cash'&&(!text('party')||!currency('currency')||!date('date')||!numeric('amount',0,1e12,true)||!enumeration('type',['قبض','صرف'])||!enumeration('partyType',['عميل','شريك','أخرى'])||(r.customerId!==undefined&&(typeof r.customerId!=='string'||!r.customerId))))fail();
 if(collection==='transfers'&&(!text('sender')||!text('recipient')||!currency('currency')||!date('date')||!numeric('amount',0,1e12,true)||!numeric('commission',0,1e12)||!enumeration('direction',['incoming','outgoing'])||!enumeration('status',['مسلمة','معلقة','قيد المعالجة','ملغاة','بانتظار التسليم','قيد المراجعة'])||(r.deliveredAt!==''&&!date('deliveredAt'))))fail();
 if((collection==='rates'||collection==='rateLog')&&(!text('name')||!currency('base')||!currency('counter')||r.base===r.counter||!numeric('buy',0,Infinity,true)||!numeric('sell',Number(r.buy))||!date('updated')))fail();
 if(collection==='exchange'&&(!text('party')||!date('date')||!currency('currency')||!currency('counter')||r.currency===r.counter||!enumeration('type',['شراء','بيع'])||!enumeration('status',['مكتملة','معلقة','ملغاة'])||!numeric('amount',0,1e12,true)||!numeric('rate',0,1e6,true)||!numeric('counterpart',0,1e18,true)||!numeric('commission',0,Number(r.counterpart))||Math.abs(Number(r.counterpart)-Number(r.amount)*Number(r.rate))>Math.max(1e-6,Number(r.counterpart)*1e-12)))fail();
 if(collection==='inventorySales'){
 if(!text('customerId')||!text('customerName')||!date('date')||!currency('currency')||!numeric('total',0,1e18,true)||!Array.isArray(r.lines)||!r.lines.length||r.lines.length>50)return fail();let total=0;const items=new Set();for(const line of r.lines){if(!line||typeof line.itemId!=='string'||items.has(line.itemId)||typeof line.name!=='string'||![line.quantity,line.purchasePrice,line.salePrice].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12)||line.quantity<=0)return fail();items.add(line.itemId);total+=line.quantity*line.salePrice;}if(Math.abs(total-Number(r.total))>0.000001)fail();
 }
 if(collection==='inventoryCustomers'){
 if(!text('name')||!text('phone'))fail();const rows=r.transactions??[];if(!Array.isArray(rows))return fail();const ids=new Set<string>();const totals:Record<string,number>=Object.create(null);
 for(const x of rows){if(!x||typeof x.id!=='string'||ids.has(x.id)||typeof x.date!=='string'||!Number.isFinite(Date.parse(x.date))||!['debt','payment'].includes(x.type)||typeof x.currency!=='string'||!x.currency.trim()||['__proto__','constructor','prototype'].includes(x.currency)||typeof x.amount!=='number'||!Number.isFinite(x.amount)||x.amount<=0||x.amount>1e12||typeof x.details!=='string')return fail();ids.add(x.id);totals[x.currency]=Math.round(((totals[x.currency]||0)+(x.type==='debt'?x.amount:-x.amount))*1e6)/1e6;}
 if(Object.values(totals).some(n=>!Number.isFinite(n)||n<0))fail();
 }
 if(collection==='inventory'&&(!text('name')||!numeric('quantity',0,1e12)||!numeric('purchasePrice',0,1e12)||!numeric('salePrice',0,1e12)))fail();
 if(collection==='wallets'&&(!text('name')||!numeric('balance',0,1e12)))fail();
}
export const head=query({args:{token:v.string()},handler:async(ctx,{token})=>{const {m}=await session(ctx,await digest(token));if(!m)throw new ConvexError('MERCHANT_REQUIRED');return {cursor:m.revision};}});
export const pull=query({args:{token:v.string(),since:v.number()},handler:async(ctx,{token,since})=>{
 const {m}=await session(ctx,await digest(token));if(!m)throw new ConvexError('MERCHANT_REQUIRED');if(!Number.isSafeInteger(since)||since<0)throw new ConvexError('INVALID_CURSOR');
 const rows=await ctx.db.query('records').withIndex('revision',q=>q.eq('merchantId',m._id).gt('version',since)).order('asc').take(101);
 // Never split a revision (all records in an atomic operation share its version).
 const limited=rows.length>100;const boundary=limited?rows[100].version:Infinity;const candidates=limited?rows.filter(r=>r.version<boundary):rows;
 const visible:typeof rows=[];let bytes=0;
 for(const row of candidates){const size=new TextEncoder().encode(JSON.stringify(row)).length;if(bytes+size>512*1024&&visible.length&&visible.at(-1)?.version!==row.version)break;visible.push(row);bytes+=size;}
 const hasMore=limited||visible.length<candidates.length;
 const cursor=hasMore?(visible.at(-1)?.version??since):m.revision;
 return {cursor,hasMore,changes:visible.map(r=>({collection:r.collection,id:r.recordId,value:r.value,version:r.version}))};
}});
export const push=mutation({args:{token:v.string(),operationId:v.string(),changes:v.array(change)},handler:async(ctx,{token,operationId,changes})=>{
 const {m}=await session(ctx,await digest(token));if(!m)throw new ConvexError('MERCHANT_REQUIRED');if(m.expiresAt<=Date.now())throw new ConvexError('SUBSCRIPTION_EXPIRED');if(!operationId||operationId.length>160||changes.length<1||changes.length>100)throw new ConvexError('INVALID_OPERATION');
 if(new TextEncoder().encode(JSON.stringify(changes)).length>128*1024)throw new ConvexError('PAYLOAD_TOO_LARGE');
 const prior=await ctx.db.query('operations').withIndex('operation',q=>q.eq('merchantId',m._id).eq('operationId',operationId)).unique();if(prior)return {ok:true,cursor:prior.cursor};
 const keys=new Set<string>();
 for(const c of changes){validate(c.collection,c.id,c.value);if(!Number.isSafeInteger(c.baseVersion)||c.baseVersion<0)throw new ConvexError('INVALID_VERSION');const key=c.collection+'\0'+c.id;if(keys.has(key))throw new ConvexError('DUPLICATE_RECORD');keys.add(key);}
 const current=await Promise.all(changes.map(c=>ctx.db.query('records').withIndex('record',q=>q.eq('merchantId',m._id).eq('collection',c.collection).eq('recordId',c.id)).unique()));
 const conflicts=changes.flatMap((c,i)=>{const row=current[i];return (row?.version??0)!==c.baseVersion?[{collection:c.collection,id:c.id,value:row?.value??null,version:row?.version??0}]:[];});
 if(conflicts.length)return {ok:false,conflicts};
 const cursor=m.revision+1;
 for(let i=0;i<changes.length;i++){const c=changes[i],row=current[i];if(row)await ctx.db.patch(row._id,{value:c.value,version:cursor});else await ctx.db.insert('records',{merchantId:m._id,collection:c.collection,recordId:c.id,value:c.value,version:cursor});}
 await ctx.db.patch(m._id,{revision:cursor});await ctx.db.insert('operations',{merchantId:m._id,operationId,cursor});return {ok:true,cursor};
}});
