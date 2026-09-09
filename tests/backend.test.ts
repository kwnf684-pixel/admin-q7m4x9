import {afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {anyApi} from 'convex/server';
import schema from '../convex/schema';
import {digest} from '../convex/access';
import {pbkdf2Sync} from 'node:crypto';
const modules=import.meta.glob('../convex/**/*.ts');
const day=86400000;
async function setup(){
 const t=convexTest({schema,modules,transactionLimits:true});const now=Date.now();
 const admin='a'.repeat(64),alice='b'.repeat(64),bob='c'.repeat(64);
 const ids=await t.run(async ctx=>{
 const values={name:'Merchant',salt:'00'.repeat(16),passwordHash:'11'.repeat(32),subscriptionDays:30,startsAt:now,expiresAt:now+30*day,frozen:false,deleted:false,revision:0};
 const a=await ctx.db.insert('merchants',{...values,whatsapp:'9647700000001'}),b=await ctx.db.insert('merchants',{...values,whatsapp:'9647700000002'});
 await ctx.db.insert('sessions',{tokenHash:await digest(admin),role:'admin',expiresAt:now+7*day});
 for(const [token,id] of [[alice,a],[bob,b]] as const)await ctx.db.insert('sessions',{tokenHash:await digest(token),role:'merchant',merchantId:id,credentialHash:values.passwordHash,expiresAt:now+7*day});return {a,b};
 });return {t,admin,alice,bob,...ids};
}
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
describe('tenant auth and atomic sync',()=>{
 it('rejects unknown token and merchant admin access; never shares tenant records',async()=>{
 const {t,alice,bob}=await setup();await expect(t.query(anyApi.sync.head,{token:'invalid'})).rejects.toThrow();await expect(t.query(anyApi.merchants.list,{token:alice})).rejects.toThrow();
 await t.mutation(anyApi.sync.push,{token:alice,operationId:'op1',changes:[{collection:'wallets',id:'w',value:{id:'w',name:'Wallet',balance:42},baseVersion:0}]});
 expect((await t.query(anyApi.sync.pull,{token:bob,since:0})).changes).toEqual([]);expect((await t.query(anyApi.sync.pull,{token:alice,since:0})).changes).toHaveLength(1);
 });
 it('deduplicates operations and rejects entire conflicting batches',async()=>{
 const {t,alice}=await setup();const first={token:alice,operationId:'once',changes:[{collection:'wallets',id:'w',value:{id:'w',name:'Wallet',balance:10},baseVersion:0}]};
 expect(await t.mutation(anyApi.sync.push,first)).toEqual({ok:true,cursor:1});expect(await t.mutation(anyApi.sync.push,first)).toEqual({ok:true,cursor:1});
 const conflict=await t.mutation(anyApi.sync.push,{token:alice,operationId:'conflict',changes:[{...first.changes[0],value:null},{collection:'wallets',id:'w2',value:{id:'w2',name:'other',balance:20},baseVersion:0}]});
 expect(conflict.ok).toBe(false);const pulled=await t.query(anyApi.sync.pull,{token:alice,since:0});expect(pulled.cursor).toBe(1);expect(pulled.changes).toHaveLength(1);
 await t.mutation(anyApi.sync.push,{token:alice,operationId:'delete',changes:[{collection:'wallets',id:'w',value:null,baseVersion:1}]});expect((await t.query(anyApi.sync.pull,{token:alice,since:1})).changes[0].value).toBeNull();
 });
 it('frozen accounts retain data but cannot read/write until resumed',async()=>{
 const {t,alice,admin,a}=await setup();await t.mutation(anyApi.merchants.freeze,{token:admin,id:a,frozen:true});expect((await t.query(anyApi.access.status,{token:alice})).status).toBe('frozen');await expect(t.query(anyApi.sync.head,{token:alice})).rejects.toThrow('ACCESS_REVOKED');await t.mutation(anyApi.merchants.freeze,{token:admin,id:a,frozen:false});expect((await t.query(anyApi.access.status,{token:alice})).status).toBe('active');
 });
 it('at exact expiry reads remain available but business writes are denied',async()=>{
 vi.useFakeTimers();const {t,alice,a}=await setup();const now=Date.now();await t.run(ctx=>ctx.db.patch(a,{expiresAt:now+1}));expect((await t.query(anyApi.access.status,{token:alice})).status).toBe('active');vi.setSystemTime(now+1);const status=await t.query(anyApi.access.status,{token:alice});expect(status.status).toBe('expired');expect(status.merchantId).toBe(a);expect(await t.query(anyApi.sync.head,{token:alice})).toEqual({cursor:0});expect((await t.query(anyApi.sync.pull,{token:alice,since:0})).changes).toEqual([]);
 await expect(t.mutation(anyApi.sync.push,{token:alice,operationId:'expired',changes:[{collection:'wallets',id:'w',value:{id:'w',name:'x',balance:2},baseVersion:0}]})).rejects.toThrow('SUBSCRIPTION_EXPIRED');
 });
 it('permanently removes only selected tenant with code101; retains hashed deletion notification',async()=>{
 vi.useFakeTimers();const {t,admin,alice,bob,a}=await setup();await t.run(async ctx=>{for(let i=0;i<120;i++)await ctx.db.insert('records',{merchantId:a,collection:'wallets',recordId:String(i),value:null,version:1});await ctx.db.insert('operations',{merchantId:a,operationId:'old',cursor:1});});
 await expect(t.mutation(anyApi.merchants.remove,{token:admin,id:a,code:'wrong'})).rejects.toThrow('INVALID_DELETE_CODE');await t.mutation(anyApi.merchants.remove,{token:admin,id:a,code:'101'});expect((await t.query(anyApi.access.status,{token:alice})).status).toBe('deleted');
 await t.mutation(anyApi.merchants.purge,{id:a});await t.mutation(anyApi.merchants.purge,{id:a});
 expect(await t.run(ctx=>ctx.db.get(a))).toBeNull();expect(await t.run(ctx=>ctx.db.query('records').collect())).toEqual([]);expect(await t.run(ctx=>ctx.db.query('operations').collect())).toEqual([]);expect((await t.query(anyApi.access.status,{token:alice})).status).toBe('deleted');expect((await t.query(anyApi.access.status,{token:bob})).status).toBe('active');
 });
 it('validates all records atomically and preserves history wrapper',async()=>{
 const {t,alice}=await setup();await expect(t.mutation(anyApi.sync.push,{token:alice,operationId:'invalid',changes:[{collection:'wallets',id:'w',value:{id:'w',name:'x',balance:'wrong'},baseVersion:0}]})).rejects.toThrow('INVALID_DATA');
 expect(await t.mutation(anyApi.sync.push,{token:alice,operationId:'history',changes:[{collection:'rateLog',id:'history',value:{rows:[{id:'r',name:'Dollar',base:'USD',counter:'IQD',buy:1300,sell:1310,user:'test',notes:'',updated:'2026-09-09T10:00:00'}]},baseVersion:0}]})).toEqual({ok:true,cursor:1});
 });
});

describe('password authentication',()=>{
 it('verifies salted password, limits failures, rotates password and retains only current session',async()=>{
 const {t,a}=await setup();const password='test-password-7319',salt='12'.repeat(16);const hashed=pbkdf2Sync(password,Buffer.from(salt,'hex'),150000,32,'sha256').toString('hex');
 await t.run(ctx=>ctx.db.patch(a,{salt,passwordHash:hashed}));
 await expect(t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password:'wrong'})).rejects.toThrow('INVALID_CREDENTIALS');
 await t.run(ctx=>ctx.db.patch(a,{expiresAt:Date.now()-1}));const expiredLogin=await t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password});expect(expiredLogin.merchantId).toBe(a);await expect(t.action(anyApi.auth.changePassword,{token:expiredLogin.token,current:password,password:'new-password'})).rejects.toThrow('SUBSCRIPTION_EXPIRED');await t.run(ctx=>ctx.db.patch(a,{expiresAt:Date.now()+day}));
 const first=await t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password});const other=await t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password});
 expect(first.token).toHaveLength(64);expect(first.merchantId).toBe(a);
 await t.action(anyApi.auth.changePassword,{token:first.token,current:password,password:'updated-test-password'});
 expect((await t.query(anyApi.access.status,{token:first.token})).status).toBe('active');expect((await t.query(anyApi.access.status,{token:other.token})).status).toBe('unauthorized');
 await expect(t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password})).rejects.toThrow('INVALID_CREDENTIALS');
 expect((await t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password:'updated-test-password'})).merchantId).toBe(a);
 for(let i=0;i<10;i++)expect((await t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password:'updated-test-password'})).merchantId).toBe(a);
 for(let i=0;i<8;i++)await expect(t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password:'bad'})).rejects.toThrow('INVALID_CREDENTIALS');
 await expect(t.action(anyApi.auth.login,{role:'merchant',phone:'07700000001',password:'updated-test-password'})).rejects.toThrow('TOO_MANY_ATTEMPTS');
 });
});
const validRecords:Record<string,Record<string,unknown>>={
 customers:{id:'customer',name:'Customer',phone:'',address:'',notes:'',active:true,created:'2026-09-09T10:00:00',updated:'2026-09-09T10:00:00',lastActivity:'—',balances:{USD:-10,IQD:100}},
 cash:{id:'cash',date:'2026-09-09T10:00:00',party:'Customer',partyType:'عميل',currency:'USD',amount:25,type:'قبض',reason:'',reference:'',description:'',notes:'',customerId:'customer'},
 transfers:{id:'transfer',date:'2026-09-09T10:00:00',sender:'Sender',recipient:'Recipient',currency:'USD',status:'معلقة',direction:'outgoing',office:'',senderPhone:'',recipientPhone:'',senderAddress:'',recipientAddress:'',notes:'',reason:'',voucher:'',deliveredAt:'',amount:100,commission:0},
 rates:{id:'rate',base:'USD',counter:'IQD',name:'Dollar',user:'test',updated:'2026-09-09T10:00:00',notes:'',buy:1300,sell:1310},
 exchange:{id:'exchange',date:'2026-09-09T10:00:00',party:'Customer',currency:'USD',counter:'IQD',type:'بيع',status:'مكتملة',box:'main',user:'test',description:'',notes:'',amount:10,rate:1300,commission:0,counterpart:13000}
};
describe('frontend record contract',()=>{
 it('accepts complete form records and rejects every missing required field atomically',async()=>{
 const {t,alice}=await setup();let operation=0;
 for(const [collection,record] of Object.entries(validRecords)){
 for(const field of Object.keys(record).filter(k=>k!=='customerId')){
 const incomplete={...record};delete incomplete[field];
 await expect(t.mutation(anyApi.sync.push,{token:alice,operationId:'missing-'+operation++,changes:[{collection:'wallets',id:'untouched',value:{id:'untouched',name:'Untouched',balance:1},baseVersion:0},{collection,id:record.id,value:incomplete,baseVersion:0}]})).rejects.toThrow('INVALID_DATA');
 }
 }
 expect(await t.query(anyApi.sync.head,{token:alice})).toEqual({cursor:0});
 const changes=Object.entries(validRecords).map(([collection,value])=>({collection,id:value.id,value,baseVersion:0}));expect(await t.mutation(anyApi.sync.push,{token:alice,operationId:'valid',changes})).toEqual({ok:true,cursor:1});
 });
 it('rejects invalid dates, currencies, enums and monetary ranges',async()=>{
 const {t,alice}=await setup();let operation=0;
 const invalid:[string,Record<string,unknown>][]=[['cash',{type:'hacked'}],['cash',{partyType:'hacked'}],['cash',{amount:-1}],['cash',{amount:1e12+1}],['cash',{date:'invalid'}],['cash',{currency:''}],['cash',{customerId:42}],['transfers',{direction:'hacked'}],['transfers',{status:'hacked'}],['transfers',{commission:-1}],['transfers',{deliveredAt:'invalid'}],['exchange',{counterpart:12}],['exchange',{rate:1e6+1}],['exchange',{commission:13001}],['rates',{sell:1}],['customers',{active:'yes'}]];
 for(const [collection,patch] of invalid){const value={...validRecords[collection],...patch};await expect(t.mutation(anyApi.sync.push,{token:alice,operationId:'invalid-'+operation++,changes:[{collection,id:value.id,value,baseVersion:0}]})).rejects.toThrow('INVALID_DATA');}
 expect(await t.query(anyApi.sync.head,{token:alice})).toEqual({cursor:0});
 });
});
it('changes admin credential securely, revokes other sessions and rejects merchant/wrong-current',async()=>{
 const salt='12'.repeat(16),old='Original-test-123',next='Next-test-456';const passwordHash=pbkdf2Sync(old,Buffer.from(salt,'hex'),150000,32,'sha256').toString('hex');
 vi.stubEnv('ADMIN_PASSWORD_SALT',salt);vi.stubEnv('ADMIN_PASSWORD_HASH',passwordHash);
 try{const {t,admin,alice}=await setup();const second=await t.action(anyApi.auth.login,{role:'admin',phone:'',password:old});
 await expect(t.action(anyApi.auth.changeAdminPassword,{token:alice,current:old,password:next})).rejects.toThrow();
 await expect(t.action(anyApi.auth.changeAdminPassword,{token:admin,current:'incorrect',password:next})).rejects.toThrow();
 await t.action(anyApi.auth.changeAdminPassword,{token:admin,current:old,password:next});
 expect(await t.query(anyApi.access.me,{token:second.token})).toBeNull();expect((await t.query(anyApi.access.status,{token:second.token})).status).toBe('unauthorized');
 expect((await t.query(anyApi.access.me,{token:admin}))?.role).toBe('admin');expect((await t.query(anyApi.access.me,{token:alice}))?.role).toBe('merchant');
 await expect(t.action(anyApi.auth.login,{role:'admin',phone:'',password:old})).rejects.toThrow();const renewed=await t.action(anyApi.auth.login,{role:'admin',phone:'',password:next});expect(renewed.role).toBe('admin');
 const stored=await t.run(ctx=>ctx.db.query('adminCredentials').unique());expect(stored?.passwordHash).not.toBe(next);expect(stored).not.toHaveProperty('password');
 }finally{vi.unstubAllEnvs();}
});
