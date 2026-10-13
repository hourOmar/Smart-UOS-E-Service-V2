import { API_BASE_URL } from '../config/api'
import { supabase } from './supabase'

// Calls to the Smart UoS E-Service backend (staff-only routes). The signed-in
// user's Supabase access token is sent as a bearer token; the backend verifies
// it and the Authorized_Staff link before reading anything.

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface ServiceMessages {
  /** e.g. 'eligibility service', used in the generic messages. */
  service: string
  /** Messages for specific HTTP statuses (401 and 403 have defaults). */
  byStatus?: Record<number, string>
}

const DEFAULT_MESSAGES: Record<number, string> = {
  401: 'Your session has expired. Sign in again.',
  403: 'This page is for staff only.',
}

export async function callBackend<T>(path: string, init: RequestInit | undefined, messages: ServiceMessages): Promise<T> {
  const byStatus = { ...DEFAULT_MESSAGES, ...messages.byStatus }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError(401, byStatus[401])

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...init?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  } catch {
    throw new ApiError(0, `The ${messages.service} could not be reached.`)
  }

  if (!response.ok) {
    // The development proxy answers 5xx when the backend is not running.
    const message =
      byStatus[response.status] ??
      (response.status >= 500
        ? `The ${messages.service} is unavailable. Try again shortly.`
        : `The ${messages.service} returned an error (${response.status}).`)
    throw new ApiError(response.status, message)
  }
  return (await response.json()) as T
}
