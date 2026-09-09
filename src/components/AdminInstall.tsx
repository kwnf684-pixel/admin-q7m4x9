import {useEffect,useState} from 'react';
import {AnimatePresence,motion,useReducedMotion} from 'motion/react';
import './adminInstall.css';
type InstallEvent=Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const standalone=()=>matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator & {standalone?:boolean}).standalone);
export default function AdminInstall(){
 const [installed,setInstalled]=useState(standalone);
 const [closed,setClosed]=useState(()=>{try{return sessionStorage.getItem('admin-install-dismissed')==='1';}catch{return false;}});
 const [prompt,setPrompt]=useState<InstallEvent|null>(null);
 const [help,setHelp]=useState(false),[busy,setBusy]=useState(false);
 const reduce=useReducedMotion();
 useEffect(()=>{
  const ready=(event:Event)=>{event.preventDefault();setPrompt(event as InstallEvent);};
  const done=()=>{setInstalled(true);setPrompt(null);};
  const mode=matchMedia('(display-mode: standalone)');const changed=()=>setInstalled(standalone());
  window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',done);mode.addEventListener('change',changed);
  return()=>{window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',done);mode.removeEventListener('change',changed);};
 },[]);
 function dismiss(){setClosed(true);try{sessionStorage.setItem('admin-install-dismissed','1');}catch{/* Optional preference only. */}}
 async function install(){if(!prompt){setHelp(true);return;}setBusy(true);try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome==='accepted')setInstalled(true);}catch{setHelp(true);}finally{setPrompt(null);setBusy(false);}}
 if(installed)return null;
 return <><AnimatePresence>{!closed&&<motion.aside className="admin-install panel" aria-label="تثبيت تطبيق الإدارة" dir="rtl" initial={{opacity:0,y:reduce?0:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:12}} transition={{duration:.18}}><img src={`${import.meta.env.BASE_URL}admin-icon-192.png`} alt="شعار تطبيق الأدمن"/><div><strong>إدارة أعمال المستقبل بين يديك</strong><p>ثبّت تطبيق الإدارة للوصول السريع من جهازك. إدارة التجار تتطلب الإنترنت.</p>{help&&<p role="status">على iPhone: افتح الرابط في Safari ثم مشاركة ← إضافة إلى الشاشة الرئيسية. على Chrome أو Edge: قائمة المتصفح ← تثبيت التطبيق أو التطبيقات. إذا لم يظهر الخيار استخدم المتصفح مباشرة.</p>}<div className="admin-install-actions"><button className="tl-button primary" onClick={install} disabled={busy}>{busy?'جارٍ فتح التثبيت…':prompt?'تثبيت التطبيق':'طريقة تثبيت التطبيق'}</button><button className="tl-button" onClick={dismiss}>لاحقًا</button></div></div></motion.aside>}</AnimatePresence>{closed&&<button className="tl-button admin-install-reopen" onClick={()=>setClosed(false)}>تثبيت التطبيق</button>}</>;
}
