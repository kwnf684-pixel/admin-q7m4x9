import {useState,useSyncExternalStore} from 'react';
import type {ReactNode,FormEvent} from 'react';
import {isUnlocked,loginLocal,subscribeAccess,accessError,accessVersion} from '../data/localAccess';
import './localAccess.css';
export default function LocalAccess({children}:{children:ReactNode}){
 useSyncExternalStore(subscribeAccess,accessVersion);const unlocked=isUnlocked();const phone='';const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{if(!await loginLocal(phone,password)){setError('الرقم أو رمز الإدارة غير صحيحة.');return;}setPassword('');}catch{setError('تعذر تسجيل الدخول. تحقق من البيانات والاتصال أو تواصل مع الإدارة.');}finally{setBusy(false);}}
 if(unlocked)return <>{children}</>;
 return <main className="local-login" dir="rtl"><section className="panel local-login-card"><img src={`${import.meta.env.BASE_URL}admin-icon-512.png`} alt="شعار أعمال المستقبل"/><p className="eyebrow">أعمال المستقبل</p><h1>دخول الإدارة</h1><p>لوحة إدارة تجار الصيرفة</p><form onSubmit={submit}><label className="tl-field"><span>رمز الإدارة</span><input aria-label="رمز الإدارة" type="password" autoComplete="current-password" placeholder="أدخل رمز الإدارة" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{(error||accessError())&&<p role="alert" className="tl-error">{error||accessError()}</p>}<button className="tl-button primary" disabled={busy}>{busy?'جارٍ التحقق…':'تسجيل الدخول'}</button></form><small>دخول الإدارة محمي بالتحقق من الخادم</small></section></main>;
}
