import mongoose from 'mongoose'
import { env } from './env'

export async function connectMongo() {
  try {
    await mongoose.connect(env.MONGO_URI)
    console.log('[mongo] connected')
  } catch (err) {
    console.error('[mongo] connection failed:', err)
    throw err
  }
}
