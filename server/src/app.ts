import cors from 'cors'
import express from 'express'
import { env } from './config/env'

export const app = express()

app.use(cors({ origin: env.CLIENT_URL }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})
