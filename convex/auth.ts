"use node";
import {anyApi} from 'convex/server';
import {action,internalAction} from './model';
import {v,ConvexError} from 'convex/values';
import {pbkdf2Sync,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
export function normalizePhone(value:string){let p=value.trim().replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[\s()+-]/g,'');if(p.startsWith('00'))p=p.slice(2);if(/^07\d{9}$/.test(p))p='964'+p.slice(1);return p;}
function hash(password:string,salt:string){return pbkdf2Sync(password,Buffer.from(salt,'hex'),150000,32,'sha256').toString('hex');}
export const hashPassword=internalAction({args:{password:v.string()},handler:async(_,a)=>{if(a.password.length<4||a.password.length>256)throw new ConvexError('INVALID_PASSWORD');const salt=randomBytes(16).toString('hex');return {salt,passwordHash:hash(a.password,salt)};}});
export const login=action({args:{role:v.union(v.literal('admin'),v.literal('merchant')),phone:v.string(),password:v.string()},handler:async(ctx,a)=>{
 if(a.phone.length>40||a.password.length>256)throw new ConvexError('INVALID_CREDENTIALS');const phone=normalizePhone(a.phone);
 if(!await ctx.runMutation(anyApi.access.reserve,{key:a.role==='admin'?'admin':phone}))throw new ConvexError('TOO_MANY_ATTEMPTS');
 const m=await ctx.runQuery(anyApi.access.lookup,{role:a.role,phone});
 const salt=a.role==='admin'?process.env.ADMIN_PASSWORD_SALT:m?.salt;
 const expected=a.role==='admin'?process.env.ADMIN_PASSWORD_HASH:m?.passwordHash;
 if(a.role==='admin'&&(!salt||!expected))throw new ConvexError('ADMIN_NOT_CONFIGURED');
 const actual=hash(a.password,salt??'00'.repeat(16));const target=typeof expected==='string'&&/^[a-f0-9]{64}$/i.test(expected)?expected:'00'.repeat(32);
 if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(target,'hex'))||!expected)throw new ConvexError('INVALID_CREDENTIALS');
 const token=randomBytes(32).toString('hex');const profile=await ctx.runMutation(anyApi.access.issue,{tokenHash:createHash('sha256').update(token).digest('hex'),role:a.role,...(m?{merchantId:m._id,expectedHash:expected}:{})});return {token,...profile};
}});

export const changePassword=action({args:{token:v.string(),current:v.string(),password:v.string()},handler:async(ctx,a)=>{
 if(a.current.length>256||a.password.length<4||a.password.length>256)throw new ConvexError('INVALID_PASSWORD');
 const credential=await ctx.runQuery(anyApi.access.credential,{token:a.token});if(credential.expiresAt<=Date.now())throw new ConvexError('SUBSCRIPTION_EXPIRED');
 if(!await ctx.runMutation(anyApi.access.reserve,{key:'change:'+credential.id}))throw new ConvexError('TOO_MANY_ATTEMPTS');
 if(!timingSafeEqual(Buffer.from(hash(a.current,credential.salt),'hex'),Buffer.from(credential.passwordHash,'hex')))throw new ConvexError('INVALID_CREDENTIALS');
 const salt=randomBytes(16).toString('hex');return await ctx.runMutation(anyApi.access.replacePassword,{token:a.token,previous:credential.passwordHash,salt,passwordHash:hash(a.password,salt)});
}});
