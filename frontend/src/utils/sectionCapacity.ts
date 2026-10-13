// Student-facing seat availability for a course section.
// Confirmed rule: a section is Full when Current_Capacity >= Total_Capacity;
// otherwise the available seats are Total_Capacity - Current_Capacity.
// Additional_Capacity (extra room an administrator may approve) never counts
// as available to students and is not read by student pages.

export interface SeatStatus {
  full: boolean
  available: number
  label: string
}

export function seatStatus(current: number, total: number): SeatStatus {
  if (current >= total) {
    return { full: true, available: 0, label: 'Full' }
  }

  const available = total - current
  return {
    full: false,
    available,
    label: `${available} ${available === 1 ? 'seat' : 'seats'} available`,
  }
}
