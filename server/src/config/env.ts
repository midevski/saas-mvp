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
})

export const env = envSchema
  .refine((e) => !(e.NODE_ENV === 'production' && e.BILLING_GATE_DISABLED), {
    message: 'BILLING_GATE_DISABLED must not be enabled in production',
  })
  .parse(process.env)
