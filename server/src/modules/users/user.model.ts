import { Schema, model } from 'mongoose'

export interface UserDocument {
  email: string
  passwordHash: string
  name: string
  createdAt: Date
}

const userSchema = new Schema<UserDocument>({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
})

export const User = model<UserDocument>('User', userSchema)
