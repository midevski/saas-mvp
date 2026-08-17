import axios from 'axios'

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

let accessToken: string | null = null
let onAuthFailure: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function setOnAuthFailure(handler: (() => void) | null) {
  onAuthFailure = handler
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// Endpoints where a 401 is an expected outcome, not a signal to try refreshing
const NO_REFRESH_RETRY = ['/auth/login', '/auth/register', '/auth/refresh']

let refreshPromise: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post<{ accessToken: string }>('/api/auth/refresh', null, {
      withCredentials: true,
    })
    setAccessToken(res.data.accessToken)
    return res.data.accessToken
  } catch {
    setAccessToken(null)
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    const shouldRetry =
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !NO_REFRESH_RETRY.some((path) => originalRequest.url?.includes(path))

    if (!shouldRetry) return Promise.reject(error)

    originalRequest._retry = true
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null
    })
    const newToken = await refreshPromise

    if (!newToken) {
      onAuthFailure?.()
      return Promise.reject(error)
    }

    originalRequest.headers.Authorization = `Bearer ${newToken}`
    return api(originalRequest)
  },
)
