import {ConvexReactClient} from 'convex/react';
import {makeFunctionReference} from 'convex/server';
export const client=import.meta.env.VITE_CONVEX_URL?new ConvexReactClient(import.meta.env.VITE_CONVEX_URL):null;
export const ref=makeFunctionReference;
