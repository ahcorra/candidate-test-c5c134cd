// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimesheetEntry } from '../api/client'
import { AuthProvider } from '../hooks/useAuth'
import Approvals from './Approvals'

type Reply = number | 'hold'

interface FakeServer {
  pending: TimesheetEntry[]
  laterPages?: number
  replies?: Record<number, Reply[]>
}

function entry(id: number, date: string): TimesheetEntry {
  return {
    id,
    contract: 1,
    contract_id: 1,
    freelancer: { id: 1, name: `Freelancer ${id}` },
    daily_rate: '600.00',
    date,
    hours: '8.00',
    status: 'submitted',
    rejection_reason: null,
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// A stand-in for the API: it keeps the submitted queue and records what the page sends.
function serve(server: FakeServer) {
  const patches: Array<{ id: number; body: Record<string, unknown> }> = []
  const lists: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      const id = Number(/timesheets\/(\d+)\//.exec(url)![1])
      const body = JSON.parse(String(init.body))
      patches.push({ id, body })
      const reply = server.replies?.[id]?.shift() ?? 200
      if (reply === 'hold') return new Promise<Response>(() => {})
      if (reply === 200 || reply === 409) {
        server.pending = server.pending.filter((row) => row.id !== id)
      }
      return json(reply, reply === 200 ? { ...entry(id, '2026-09-28'), ...body } : { detail: 'Not saved.' })
    }
    lists.push(url)
    const params = new URL(url, 'http://localhost').searchParams
    const from = params.get('date_from')
    const to = params.get('date_to')
    if (from && to && from > to) return json(400, { date_from: 'Must be on or before date_to.' })
    return json(200, {
      count: server.pending.length + (server.laterPages ?? 0),
      page: 1,
      page_size: 20,
      results: server.pending.slice(0, 20),
      weeks: [],
      contracts: [],
      freelancers: [],
    })
  }))
  return { patches, lists }
}

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <Approvals />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openBulkDialog(action: 'Approve' | 'Reject', count: number) {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all rows on this page' }))
  fireEvent.click(screen.getByRole('button', { name: `${action} ${count} selected` }))
  return screen.getByRole('dialog')
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token')
  localStorage.setItem('user', JSON.stringify({ id: 1, email: 'admin@northstar.test', role: 'admin' }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('approval inbox', () => {
  it('closes the dialog after a mixed result and retries only the row that failed', async () => {
    const { patches } = serve({
      pending: [entry(1, '2026-09-28'), entry(2, '2026-09-29'), entry(3, '2026-09-30')],
      replies: { 2: [409], 3: [500, 200] },
    })
    renderInbox()
    const dialog = await openBulkDialog('Approve', 3)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 3' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Approved 1 of 3.'))
    expect(screen.getByRole('status').textContent).toContain('Already decided by someone else: Freelancer 2')
    expect(screen.getByRole('status').textContent).toContain('still selected to try again: Freelancer 3')

    fireEvent.click(await screen.findByRole('button', { name: 'Approve 1 selected' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve 1' }))
    await waitFor(() => expect(patches.map((call) => call.id)).toEqual([1, 2, 3, 3]))
  })

  it('does not claim the filters match nothing while a full page is being approved', async () => {
    const rows = Array.from({ length: 20 }, (_, index) => entry(index + 1, `2026-09-${String(index + 1).padStart(2, '0')}`))
    serve({
      pending: rows,
      laterPages: 5,
      replies: Object.fromEntries(rows.map((row) => [row.id, ['hold' as const]])),
    })
    renderInbox()
    const dialog = await openBulkDialog('Approve', 20)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve 20' }))

    await screen.findByText('Loading the next submitted hours…')
    expect(screen.queryByText('No rows match these filters')).toBeNull()
  })

  it('needs a visible reason to reject and sends it trimmed for every row', async () => {
    const { patches } = serve({ pending: [entry(1, '2026-09-28'), entry(2, '2026-09-29')] })
    renderInbox()
    const dialog = await openBulkDialog('Reject', 2)
    const reason = within(dialog).getByRole('textbox', { name: 'Rejection reason' })
    const submit = within(dialog).getByRole('button', { name: 'Reject 2' }) as HTMLButtonElement

    fireEvent.change(reason, { target: { value: '   ' } })
    expect(submit.disabled).toBe(true)

    fireEvent.change(reason, { target: { value: '  Wrong day  ' } })
    fireEvent.click(submit)
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches.map((call) => call.body)).toEqual([
      { status: 'rejected', rejection_reason: 'Wrong day' },
      { status: 'rejected', rejection_reason: 'Wrong day' },
    ])
  })

  it('explains a reversed date range instead of asking the server', async () => {
    const { lists } = serve({ pending: [entry(1, '2026-09-28')] })
    renderInbox()
    await screen.findByRole('checkbox', { name: 'Select all rows on this page' })

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-02' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-01' } })

    await screen.findByText('From must be on or before To.')
    expect(lists.some((url) => url.includes('date_from=2026-10-02') && url.includes('date_to=2026-10-01'))).toBe(false)
    expect(screen.queryByText(/Failed to load/)).toBeNull()
  })
})
