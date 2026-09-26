import path from 'path'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_ID_PRO: z.string().min(1),
  CLIENT_URL: z.string().min(1),
  // Dev-only escape hatch: treats every org as subscribed so paywalled features can be tested
  BILLING_GATE_DISABLED: z.stringbool().default(false),

  // Card image storage: 'local' writes to UPLOADS_DIR (served at /uploads); 'cloudinary' uses a
  // free Cloudinary account and survives redeploys on hosts with ephemeral disks
  STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
  UPLOADS_DIR: z.string().min(1).default(path.resolve(process.cwd(), 'uploads')),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
})

export const env = envSchema
  .refine((e) => !(e.NODE_ENV === 'production' && e.BILLING_GATE_DISABLED), {
    message: 'BILLING_GATE_DISABLED must not be enabled in production',
  })
  .refine(
    (e) =>
      e.STORAGE_DRIVER !== 'cloudinary' ||
      (e.CLOUDINARY_CLOUD_NAME && e.CLOUDINARY_API_KEY && e.CLOUDINARY_API_SECRET),
    { message: 'STORAGE_DRIVER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET' },
  )
  .parse(process.env)
