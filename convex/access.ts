import {query,mutation,internalQuery,internalMutation} from './model';
import type {QueryCtx} from './model';
import {v,ConvexError} from 'convex/values';
export async function digest(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function session(ctx:QueryCtx,token:string,admin=false){
 if(token.length!==64)throw new ConvexError('UNAUTHORIZED');
 const s=await ctx.db.query('sessions').withIndex('hash',q=>q.eq('tokenHash',token)).unique();
 // Callers supply a SHA256 hash, never a raw bearer token to this internal helper.
 if(!s||s.expiresAt<=Date.now()||(admin&&s.role!=='admin'))throw new ConvexError('UNAUTHORIZED');
 const m=s.merchantId?await ctx.db.get(s.merchantId):null;
 if(s.role==='merchant'&&(!m||m.deleted||m.frozen||m.passwordHash!==s.credentialHash))throw new ConvexError('ACCESS_REVOKED');
 return {s,m};
}
export const me=query({args:{token:v.string()},handler:async(ctx,{token})=>{try{const {s,m}=await session(ctx,await digest(token));return {role:s.role,merchantId:s.merchantId??null,name:m?.name??'الإدارة',expiresAt:m?.expiresAt??s.expiresAt,sessionExpiresAt:s.expiresAt};}catch{return null;}}});
export const logout=mutation({args:{token:v.string()},handler:async(ctx,{token})=>{const tokenHash=await digest(token);const s=await ctx.db.query('sessions').withIndex('hash',q=>q.eq('tokenHash',tokenHash)).unique();if(s)await ctx.db.delete(s._id);}});
export const lookup=internalQuery({args:{role:v.string(),phone:v.string()},handler:async(ctx,{role,phone})=>role==='merchant'?await ctx.db.query('merchants').withIndex('phone',q=>q.eq('whatsapp',phone)).unique():null});
export const reserve=internalMutation({args:{key:v.string()},handler:async(ctx,{key})=>{const now=Date.now();const row=await ctx.db.query('loginLimits').withIndex('key',q=>q.eq('key',key)).unique();if(row&&now-row.start<900000){if(row.count>=8)return false;await ctx.db.patch(row._id,{count:row.count+1});}else if(row)await ctx.db.patch(row._id,{count:1,start:now});else await ctx.db.insert('loginLimits',{key,count:1,start:now});return true;}});
export const issue=internalMutation({args:{tokenHash:v.string(),role:v.union(v.literal('admin'),v.literal('merchant')),merchantId:v.optional(v.id('merchants')),expectedHash:v.optional(v.string())},handler:async(ctx,a)=>{const m=a.merchantId?await ctx.db.get(a.merchantId):null;if(a.role==='merchant'&&(!m||m.passwordHash!==a.expectedHash||m.deleted||m.frozen))throw new ConvexError('ACCESS_REVOKED');const loginKey=a.role==='admin'?'admin':m!.whatsapp;const limit=await ctx.db.query('loginLimits').withIndex('key',q=>q.eq('key',loginKey)).unique();if(limit)await ctx.db.delete(limit._id);const expiresAt=Date.now()+7*86400000;await ctx.db.insert('sessions',{tokenHash:a.tokenHash,role:a.role,merchantId:a.merchantId,credentialHash:m?.passwordHash,expiresAt});return {role:a.role,merchantId:a.merchantId??null,name:m?.name??'الإدارة',expiresAt:m?.expiresAt??expiresAt,sessionExpiresAt:expiresAt};}});
export const status=query({args:{token:v.string()},handler:async(ctx,{token})=>{
 const tokenHash=await digest(token);const s=await ctx.db.query('sessions').withIndex('hash',q=>q.eq('tokenHash',tokenHash)).unique();
 if(!s){const revoked=await ctx.db.query('revocations').withIndex('hash',q=>q.eq('tokenHash',tokenHash)).unique();return {status:revoked&&revoked.expiresAt>Date.now()?'deleted':'unauthorized'};}if(s.expiresAt<=Date.now())return {status:'session_expired'};
 const m=s.merchantId?await ctx.db.get(s.merchantId):null;
 if(s.role==='merchant'){
 if(!m||m.deleted)return {status:'deleted'};if(m.frozen)return {status:'frozen'};

 if(m.passwordHash!==s.credentialHash)return {status:'unauthorized'};
 }
 return {status:m&&Date.now()>=m.expiresAt?'expired':'active',role:s.role,merchantId:s.merchantId??null,name:m?.name??'الإدارة',expiresAt:m?.expiresAt??s.expiresAt,sessionExpiresAt:s.expiresAt};
}});

export const clearRevocation=internalMutation({args:{id:v.id('revocations')},handler:async(ctx,{id})=>{await ctx.db.delete(id);}});
export const credential=internalQuery({args:{token:v.string()},handler:async(ctx,{token})=>{const {m}=await session(ctx,await digest(token));if(!m)throw new ConvexError('MERCHANT_REQUIRED');return {id:m._id,salt:m.salt,passwordHash:m.passwordHash,expiresAt:m.expiresAt};}});
export const replacePassword=internalMutation({args:{token:v.string(),previous:v.string(),salt:v.string(),passwordHash:v.string()},handler:async(ctx,a)=>{const {m,s}=await session(ctx,await digest(a.token));if(!m||m.passwordHash!==a.previous)throw new ConvexError('UNAUTHORIZED');if(m.expiresAt<=Date.now())throw new ConvexError('SUBSCRIPTION_EXPIRED');await ctx.db.patch(m._id,{salt:a.salt,passwordHash:a.passwordHash});await ctx.db.patch(s._id,{credentialHash:a.passwordHash});const limit=await ctx.db.query('loginLimits').withIndex('key',q=>q.eq('key','change:'+m._id)).unique();if(limit)await ctx.db.delete(limit._id);return {ok:true};}});
// Internal maintenance only; never exposed to unauthenticated clients.
export const clearLoginLimit=internalMutation({args:{key:v.string()},handler:async(ctx,{key})=>{const row=await ctx.db.query('loginLimits').withIndex('key',q=>q.eq('key',key)).unique();if(row)await ctx.db.delete(row._id);}});
