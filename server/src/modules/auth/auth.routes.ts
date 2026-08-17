import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth'
import * as authController from './auth.controller'

export const authRouter = Router()

authRouter.post('/register', authController.registerHandler)
authRouter.post('/login', authController.loginHandler)
authRouter.post('/refresh', authController.refreshHandler)
authRouter.post('/logout', authController.logoutHandler)
authRouter.get('/me', requireAuth, authController.meHandler)
