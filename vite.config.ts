import {loadEnv} from 'vite';
import deployment from './deployment.json' with {type:'json'};
import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';export default defineConfig(({command,isPreview})=>({base:command==='build'||isPreview?'/admin-q7m4x9/':'/',plugins:[{name:'verify-production-backend',apply:'build',buildStart(){if(loadEnv('production',process.cwd(),'').VITE_CONVEX_URL!==deployment.url)throw new Error('Production build requires the configured production Convex deployment.');}},react()]}));
