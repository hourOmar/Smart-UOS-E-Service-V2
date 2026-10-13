import { callBackend } from './backendApi'

// Staff-only Raise Capacity priorities from the backend (priority agent).
// Never imported by student pages.

export type PriorityLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'MANUAL_REVIEW'

export type PriorityStateName =
  | 'saved'
  | 'needs_attention'
  | 'running'
  | 'failed'
  | 'not_started'
  | 'not_found'

export interface PriorityRun {
  id: number
  status: 'running' | 'completed' | 'failed' | 'discarded' | 'interrupted'
  trigger: 'automatic' | 'retry'
  started_at: string
  finished_at: string | null
  error_message: string | null
  model: string | null
  agent_version: string
}

export interface PriorityState {
  request_id: string
  state: PriorityStateName
  priority: PriorityLevel | null
  /** The saved result (reasoning, factor explanations, key evidence). */
  result: { reasoning?: string } | null
  attention_reason: string | null
  request_status: string | null
  can_retry: boolean
  auto_eligible: boolean
  last_run: PriorityRun | null
}

const MESSAGES = {
  service: 'priority service',
  byStatus: {
    404: 'This Raise Capacity request was not found.',
    409: 'This request cannot be retried now.',
    429: 'Other priority checks are still running. Try again shortly.',
  },
}

const BASE = '/api/staff/raise-capacity'

/** Saved states only; never starts a check. */
export async function fetchPriorities(requestIds: string[]): Promise<PriorityState[]> {
  const query = new URLSearchParams(requestIds.map((id) => ['request_id', id]))
  const body = await callBackend<{ priorities: PriorityState[] }>(`${BASE}/priorities?${query}`, undefined, MESSAGES)
  return body.priorities
}

/** Starts checks for eligible requests (In Progress, nothing saved, never
 *  checked); the backend decides. Returns every request's state. */
export async function startAutomaticPriorities(requestIds: string[]): Promise<PriorityState[]> {
  const body = await callBackend<{ priorities: PriorityState[]; started: string[] }>(
    `${BASE}/priorities/automatic`,
    { method: 'POST', body: JSON.stringify({ request_ids: requestIds }) },
    MESSAGES,
  )
  return body.priorities
}

/** Manual retry after a failed or interrupted check. */
export async function retryPriority(requestId: string): Promise<PriorityState> {
  const body = await callBackend<{ priority: PriorityState }>(
    `${BASE}/${encodeURIComponent(requestId)}/priority/retry`,
    { method: 'POST' },
    MESSAGES,
  )
  return body.priority
}
