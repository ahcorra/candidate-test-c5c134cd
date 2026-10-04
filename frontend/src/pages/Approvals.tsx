import { useAuth } from '../hooks/useAuth'

export default function Approvals() {
  const { isAdmin } = useAuth()

  // Hiding the nav link is not the authorization check. The API refuses a freelancer.
  if (!isAdmin) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-6 py-12 text-center max-w-md">
        <p className="text-slate-800 font-medium">Company admins only</p>
        <p className="text-slate-500 text-sm mt-1">
          Pending approvals are for the company admin on these contracts.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Pending approvals</h1>
      <p className="text-slate-500 text-sm">Submitted hours waiting for a decision.</p>
    </div>
  )
}
