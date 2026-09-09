import {defineSchema,defineTable} from 'convex/server';
import {v} from 'convex/values';
export default defineSchema({
 merchants:defineTable({name:v.string(),whatsapp:v.string(),salt:v.string(),passwordHash:v.string(),subscriptionDays:v.number(),startsAt:v.number(),expiresAt:v.number(),frozen:v.boolean(),deleted:v.boolean(),revision:v.number()}).index('phone',['whatsapp']),
 revocations:defineTable({tokenHash:v.string(),expiresAt:v.number()}).index('hash',['tokenHash']),
 sessions:defineTable({tokenHash:v.string(),credentialHash:v.optional(v.string()),role:v.union(v.literal('admin'),v.literal('merchant')),merchantId:v.optional(v.id('merchants')),expiresAt:v.number()}).index('hash',['tokenHash']).index('tenant',['merchantId']),
 loginLimits:defineTable({key:v.string(),count:v.number(),start:v.number()}).index('key',['key']),
 records:defineTable({merchantId:v.id('merchants'),collection:v.string(),recordId:v.string(),value:v.any(),version:v.number()}).index('record',['merchantId','collection','recordId']).index('revision',['merchantId','version']).index('tenant',['merchantId']),
 operations:defineTable({merchantId:v.id('merchants'),operationId:v.string(),cursor:v.number()}).index('operation',['merchantId','operationId']).index('tenant',['merchantId']),
});
