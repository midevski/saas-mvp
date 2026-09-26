import type { Request, Response } from 'express'
import { paramAsString } from '../../lib/params'
import * as boardService from './board.service'

// Initial page load before the socket connects; live updates come over Socket.io
export async function getBoardHandler(req: Request, res: Response) {
  const state = await boardService.getBoardState(paramAsString(req.params.orgId)!)
  res.json(state)
}
