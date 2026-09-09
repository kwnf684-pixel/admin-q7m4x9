import {anyApi} from 'convex/server';
import {query,mutation,action,internalMutation} from './model';
import {v,ConvexError} from 'convex/values';
import {session,digest} from './access';
function normalize(value:string){let p=value.trim().replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[\s()+-]/g,'');if(p.startsWith('00'))p=p.slice(2);if(/^07\d{9}$/.test(p))p='964'+p.slice(1);return p;}
export const list=query({args:{token:v.string()},handler:async(ctx,{token})=>{await session(ctx,await digest(token),true);return (await ctx.db.query('merchants').collect()).filter(m=>!m.deleted).map(m=>({id:m._id,name:m.name,whatsapp:m.whatsapp,subscriptionDays:m.subscriptionDays,startsAt:new Date(m.startsAt).toISOString(),expiresAt:new Date(m.expiresAt).toISOString(),frozen:m.frozen}));}});
const fields={token:v.string(),id:v.optional(v.id('merchants')),name:v.string(),whatsapp:v.string(),days:v.number(),renew:v.optional(v.boolean())};
export const save=action({args:{...fields,password:v.string()},handler:async(ctx,a)=>{
 // Authorize before expensive password derivation, and again atomically at commit.
 const me=await ctx.runQuery(anyApi.access.me,{token:a.token});if(me?.role!=='admin')throw new ConvexError('UNAUTHORIZED');
 if(!a.id&&!a.password)throw new ConvexError('PASSWORD_REQUIRED');
 const secret=a.password?await ctx.runAction(anyApi.auth.hashPassword,{password:a.password}):{};
 const {password:unused,...input}=a;void unused;
 return await ctx.runMutation(anyApi.merchants.commit,{...input,...secret});
}});
export const commit=internalMutation({args:{...fields,salt:v.optional(v.string()),passwordHash:v.optional(v.string())},handler:async(ctx,a)=>{
 await session(ctx,await digest(a.token),true);const name=a.name.trim(),whatsapp=normalize(a.whatsapp);
 if(!name||name.length>120||!/^\d{8,15}$/.test(whatsapp)||!Number.isInteger(a.days)||a.days<1||a.days>3650)throw new ConvexError('INVALID_MERCHANT');
 const duplicate=await ctx.db.query('merchants').withIndex('phone',q=>q.eq('whatsapp',whatsapp)).unique();if(duplicate&&duplicate._id!==a.id)throw new ConvexError('PHONE_EXISTS');
 const current=a.id?await ctx.db.get(a.id):null;if(a.id&&(!current||current.deleted))throw new ConvexError('NOT_FOUND');
 const startsAt=!current||a.renew||a.days!==current.subscriptionDays?Date.now():current.startsAt;
 const expiresAt=!current||a.renew||a.days!==current.subscriptionDays?startsAt+a.days*86400000:current.expiresAt;
 const values={name,whatsapp,subscriptionDays:a.days,startsAt,expiresAt,...(a.passwordHash?{passwordHash:a.passwordHash,salt:a.salt}:{} )};
 if(current){await ctx.db.patch(current._id,values);return {id:current._id,startsAt,expiresAt};}
 if(!a.passwordHash||!a.salt)throw new ConvexError('PASSWORD_REQUIRED');
 const id=await ctx.db.insert('merchants',{...values,passwordHash:a.passwordHash,salt:a.salt,frozen:false,deleted:false,revision:0});return {id,startsAt,expiresAt};
}});
export const freeze=mutation({args:{token:v.string(),id:v.id('merchants'),frozen:v.boolean()},handler:async(ctx,a)=>{await session(ctx,await digest(a.token),true);const m=await ctx.db.get(a.id);if(!m||m.deleted)throw new ConvexError('NOT_FOUND');await ctx.db.patch(a.id,{frozen:a.frozen});}});
export const remove=mutation({args:{token:v.string(),id:v.id('merchants'),code:v.string()},handler:async(ctx,a)=>{await session(ctx,await digest(a.token),true);if(a.code!=='101')throw new ConvexError('INVALID_DELETE_CODE');const m=await ctx.db.get(a.id);if(!m)return;if(!m.deleted)await ctx.db.patch(a.id,{deleted:true,frozen:true});await ctx.scheduler.runAfter(0,anyApi.merchants.purge,{id:a.id});}});
export const purge=internalMutation({args:{id:v.id('merchants')},handler:async(ctx,{id})=>{const m=await ctx.db.get(id);if(!m?.deleted)return;for(const table of ['records','operations','sessions'] as const){const rows=await ctx.db.query(table).withIndex('tenant',q=>q.eq('merchantId',id)).take(100);for(const row of rows){if(table==='sessions'&&'tokenHash' in row){const revocation=await ctx.db.insert('revocations',{tokenHash:row.tokenHash,expiresAt:row.expiresAt});await ctx.scheduler.runAfter(Math.max(0,row.expiresAt-Date.now()),anyApi.access.clearRevocation,{id:revocation});}await ctx.db.delete(row._id);}if(rows.length===100){await ctx.scheduler.runAfter(0,anyApi.merchants.purge,{id});return;}}for(const key of [m.whatsapp,'change:'+id]){const limit=await ctx.db.query('loginLimits').withIndex('key',q=>q.eq('key',key)).unique();if(limit)await ctx.db.delete(limit._id);}await ctx.db.delete(id);}});
