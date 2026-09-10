'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import {
  CalendarDays,
  Clock3,
  Loader2,
  UserRound,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ListFilter,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Wrench,
  Package,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BookingKind = 'service' | 'produit'

interface RdvItem {
  id: string
  contact_id?: string | null
  start_time: string
  end_time: string
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed'
  contact_name: string
  contact_phone: string

  // Détail venant de service_bookings (référencé par bookable_item_id)
  service_booking_id: string | null
  booking_kind: BookingKind
  item_title: string
  service_id: string | null
  produit_id: string | null
  time_slot: string | null
  booking_date: string | null
  end_date: string | null
}

type StatusFilter = 'Toutes' | 'confirmed' | 'pending' | 'cancelled' | 'completed'
type SortOrder = 'asc' | 'desc'

interface ContactOption {
  id: string
  name: string
  phone: string
}

interface ServiceOption {
  id: string
  title: string
  attributes: { duration?: string } | null
  price: number | null
}

// NOTE : je n'ai pas la structure exacte de la table `produits`. Je pars du
// principe qu'elle suit le même schéma que `services` (id, title, price,
// account_id) + `for_rent` (bool) — à ajuster si la vraie table diffère.
interface ProduitOption {
  id: string
  title: string
  price: number | null
}

interface RdvFormData {
  contact_id: string
  booking_kind: BookingKind
  service_id: string
  produit_id: string
  scheduled_date: string // booking_date (RDV service, ou début de location produit)
  scheduled_time: string // time_slot (heure du RDV, ou heure de prise en charge produit)
  end_date: string // uniquement pour une location de produit
  notes: string
}

const EMPTY_RDV_FORM: RdvFormData = {
  contact_id: '',
  booking_kind: 'service',
  service_id: '',
  produit_id: '',
  scheduled_date: '',
  scheduled_time: '',
  end_date: '',
  notes: '',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDurationInMinutes(val: any): number {
  if (!val) return 30
  if (typeof val === 'number') return val > 0 ? val : 30
  if (typeof val === 'object' && val !== null) {
    if ('duration' in val) {
      return parseDurationInMinutes((val as any).duration)
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && 'duration' in parsed) {
          return parseDurationInMinutes(parsed.duration)
        }
      } catch {
        // ignore
      }
    }
    const clean = trimmed.toLowerCase()
    if (clean.includes('h')) {
      const parts = clean.split('h')
      const hours = parseInt(parts[0], 10) || 0
      const mins = parseInt(parts[1], 10) || 0
      const total = hours * 60 + mins
      return total > 0 ? total : 30
    }
    const num = parseInt(clean.replace(/[^0-9]/g, ''), 10)
    return num > 0 ? num : 30
  }
  return 30
}

function isToday(dateStr: string) {
  return dateStr.split('T')[0] === new Date().toISOString().split('T')[0]
}

function getDateKey(dateStr: string) {
  return dateStr.split('T')[0]
}

function getSlot(startStr: string, endStr: string) {
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '—'

  const startLabel = start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  const endLabel = end.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

  return `${startLabel} - ${endLabel}`
}

function formatGroupDate(dateKey: string) {
  return new Date(dateKey).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
}

function formatDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusConfig(status: RdvItem['status']) {
  switch (status) {
    case 'confirmed':
      return {
        label: 'Confirmé',
        className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        icon: CheckCircle2,
      }
    case 'pending':
      return {
        label: 'En attente',
        className: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        icon: Clock,
      }
    case 'cancelled':
      return {
        label: 'Annulé',
        className: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: XCircle,
      }
    case 'completed':
      return {
        label: 'Terminé',
        className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        icon: CheckCircle2,
      }
    default:
      return {
        label: status,
        className: 'bg-muted text-foreground border-border',
        icon: Clock,
      }
  }
}

// Construit une literal daterange Postgres inclusive des deux bornes : '[start,end]'
function toDateRangeLiteral(start: string, end: string) {
  return `[${start},${end}]`
}

// service_bookings.status n'accepte que 'confirmed' | 'cancelled' (CHECK constraint) —
// le workflow complet (pending -> confirmed -> completed) n'existe que côté bookings.
function toServiceBookingStatus(bookingStatus: RdvItem['status'] | 'pending'): 'confirmed' | 'cancelled' {
  return bookingStatus === 'cancelled' ? 'cancelled' : 'confirmed'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  )
}

function RdvRow({
  rdv,
  onConfirm,
  onCancel,
  onEdit,
  onDelete,
}: {
  rdv: RdvItem
  onConfirm: (rdv: RdvItem) => void
  onCancel: (rdv: RdvItem) => void
  onEdit: (rdv: RdvItem) => void
  onDelete: (rdv: RdvItem) => void
}) {
  const config = statusConfig(rdv.status)
  const StatusIcon = config.icon
  const todayFlag = isToday(rdv.start_time)
  const KindIcon = rdv.booking_kind === 'produit' ? Package : Wrench

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 transition-colors sm:flex-row sm:items-center sm:gap-4 ${todayFlag ? 'border-primary/30' : 'border-border'
        }`}
    >
      {/* Time / period block */}
      <div className="flex w-40 shrink-0 flex-col items-start gap-0.5">
        <p className="text-xs font-medium text-muted-foreground">
          {todayFlag ? "Aujourd'hui" : formatGroupDate(getDateKey(rdv.start_time))}
        </p>
        {rdv.booking_kind === 'produit' && rdv.end_date && rdv.end_date !== rdv.booking_date ? (
          <p className="text-sm font-bold tabular-nums text-foreground">
            {formatDateShort(rdv.booking_date!)} → {formatDateShort(rdv.end_date)}
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-foreground">
            <Clock3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{getSlot(rdv.start_time, rdv.end_time)}</span>
          </p>
        )}
      </div>

      {/* Divider */}
      <div className="hidden h-10 w-px bg-border sm:block" />

      {/* Main info */}
      <div className="flex flex-1 flex-col gap-1">
        <p className="flex items-center gap-1.5 font-semibold text-foreground leading-tight">
          <KindIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {rdv.item_title}
        </p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
          {rdv.contact_name}
          {rdv.contact_phone && (
            <span className="text-xs">· {rdv.contact_phone}</span>
          )}
        </p>
      </div>

      {/* Status badge + actions */}
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
        >
          <StatusIcon className="h-3 w-3" />
          {config.label}
        </span>

        {rdv.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 text-xs"
              onClick={() => onConfirm(rdv)}
            >
              Confirmer
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-red-400/30 text-red-500 hover:bg-red-500/10 hover:text-red-500 text-xs"
              onClick={() => onCancel(rdv)}
            >
              Annuler
            </Button>
          </div>
        )}

        {/* Menu 3 points */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36 bg-popover text-popover-foreground ring-border">
            <DropdownMenuItem onClick={() => onEdit(rdv)}>
              <Pencil className="mr-2 h-4 w-4" />
              Modifier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(rdv)}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RendezVousPage() {
  const supabase = createClient()
  const { account } = useAuth()

  const [rdvList, setRdvList] = useState<RdvItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Toutes')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const [formOpen, setFormOpen] = useState(false)
  const [editingRdv, setEditingRdv] = useState<RdvItem | null>(null)
  const [formData, setFormData] = useState<RdvFormData>(EMPTY_RDV_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RdvItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  const [produits, setProduits] = useState<ProduitOption[]>([])

  // -------------------------------------------------------------------
  // Fetch rendez-vous (bookings + détail service_bookings joint en JS,
  // car bookable_item_id est une référence polymorphe sans vraie FK)
  // -------------------------------------------------------------------

  const fetchRdv = useCallback(async () => {
    if (!account?.id) return
    setLoading(true)

    const { data: bookingsData, error } = await supabase
      .from('bookings')
      .select(`
        id,
        contact_id,
        bookable_item_id,
        bookable_item_source,
        start_time,
        end_time,
        status,
        attendee_name,
        attendee_phone,
        contacts (name, phone)
      `)
      .eq('account_id', account.id)
      .eq('bookable_item_source', 'service_bookings')
      .order('start_time', { ascending: true })

    if (error) {
      console.error('Failed to fetch rendez-vous:', error)
      toast.error('Erreur lors du chargement des rendez-vous')
      setLoading(false)
      return
    }

    const sbIds = (bookingsData ?? [])
      .map((b: any) => b.bookable_item_id)
      .filter(Boolean)

    let sbMap = new Map<string, any>()
    if (sbIds.length > 0) {
      const { data: sbData, error: sbError } = await supabase
        .from('service_bookings')
        .select(`
          id,
          service_id,
          produit_id,
          booking_date,
          end_date,
          time_slot,
          rental_period,
          services (title),
          produits (title)
        `)
        .in('id', sbIds)

      if (sbError) {
        console.error('Failed to fetch service_bookings:', sbError)
      } else {
        sbMap = new Map((sbData ?? []).map((sb: any) => [sb.id, sb]))
      }
    }

    const mapped: RdvItem[] = (bookingsData ?? []).map((r: any) => {
      const sb = sbMap.get(r.bookable_item_id)
      const isProduit = !!sb?.produit_id
      return {
        id: r.id,
        contact_id: r.contact_id,
        start_time: r.start_time,
        end_time: r.end_time,
        status: r.status,
        contact_name: r.contacts?.name ?? r.attendee_name ?? '—',
        contact_phone: r.contacts?.phone ?? r.attendee_phone ?? '',
        service_booking_id: sb?.id ?? null,
        booking_kind: isProduit ? 'produit' : 'service',
        item_title: isProduit ? sb?.produits?.title ?? '—' : sb?.services?.title ?? '—',
        service_id: sb?.service_id ?? null,
        produit_id: sb?.produit_id ?? null,
        time_slot: sb?.time_slot ?? null,
        booking_date: sb?.booking_date ?? null,
        end_date: sb?.end_date ?? null,
      }
    })

    // Auto-complétion : confirmé + end_time dépassé -> completed
    const now = Date.now()
    const toComplete = mapped.filter(
      (r) => r.status === 'confirmed' && new Date(r.end_time).getTime() < now
    )

    if (toComplete.length > 0) {
      const nowIso = new Date().toISOString()
      const bookingIds = toComplete.map((r) => r.id)
      const sbIdsToComplete = toComplete.map((r) => r.service_booking_id).filter(Boolean) as string[]

      const { error: updateError } = await supabase
        .from('bookings')
        .update({ status: 'completed', updated_at: nowIso })
        .in('id', bookingIds)

      // Pas de mise à jour de service_bookings ici : 'completed' n'est pas une
      // valeur autorisée par service_bookings_status_check (confirmed|cancelled
      // uniquement) — le service_booking reste 'confirmed', seul bookings.status
      // avance jusqu'à 'completed'.

      if (updateError) {
        console.error('Erreur mise à jour auto des statuts:', updateError)
      } else {
        const completedIds = new Set(bookingIds)
        mapped.forEach((r) => {
          if (completedIds.has(r.id)) r.status = 'completed'
        })
      }
    }

    setRdvList(mapped)
    setLoading(false)
  }, [supabase, account?.id])

  useEffect(() => {
    fetchRdv()
  }, [fetchRdv])

  // -------------------------------------------------------------------
  // Options (contacts, services, produits)
  // -------------------------------------------------------------------

  const fetchOptions = useCallback(async () => {
    if (!account?.id) return

    try {
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', account.id)
        .order('name')

      if (contactsError) console.error('Erreur contacts:', contactsError)

      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('id, title, attributes, price')
        .eq('account_id', account.id)
        .order('title')

      if (servicesError) console.error('Erreur services:', servicesError)

      const { data: produitsData, error: produitsError } = await supabase
        .from('produits')
        .select('id, title, price')
        .eq('account_id', account.id)
        .eq('for_rent', true)
        .order('title')

      if (produitsError) console.error('Erreur produits:', produitsError)

      setContacts((contactsData ?? []) as ContactOption[])
      setServices((servicesData ?? []) as ServiceOption[])
      setProduits((produitsData ?? []) as ProduitOption[])
    } catch (error) {
      console.error('Erreur:', error)
    }
  }, [supabase, account?.id])

  useEffect(() => {
    fetchOptions()
  }, [fetchOptions])

  // -------------------------------------------------------------------
  // Modal open/close
  // -------------------------------------------------------------------

  function openCreateModal() {
    setEditingRdv(null)
    setFormData(EMPTY_RDV_FORM)
    setFormOpen(true)
  }

  function openEditModal(rdv: RdvItem) {
    setEditingRdv(rdv)
    const dateObj = new Date(rdv.start_time)
    const dateStr = rdv.booking_date ?? dateObj.toISOString().split('T')[0]
    const timeStr = rdv.time_slot ?? dateObj.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    setFormData({
      contact_id: rdv.contact_id || '',
      booking_kind: rdv.booking_kind,
      service_id: rdv.service_id || '',
      produit_id: rdv.produit_id || '',
      scheduled_date: dateStr,
      scheduled_time: timeStr,
      end_date: rdv.end_date || '',
      notes: '',
    })
    setFormOpen(true)
  }

  // -------------------------------------------------------------------
  // Save (création / édition) — écrit d'abord service_bookings, puis bookings
  // -------------------------------------------------------------------

  async function handleSave() {
    if (!formData.contact_id || !formData.scheduled_date || !formData.scheduled_time) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }
    if (formData.booking_kind === 'service' && !formData.service_id) {
      toast.error('Veuillez sélectionner un service')
      return
    }
    if (formData.booking_kind === 'produit' && !formData.produit_id) {
      toast.error('Veuillez sélectionner un produit')
      return
    }
    if (formData.booking_kind === 'produit' && !formData.end_date) {
      toast.error('Veuillez indiquer la date de fin de location')
      return
    }
    if (!account?.id) return

    const contact = contacts.find((c) => c.id === formData.contact_id)
    const startTimeObj = new Date(`${formData.scheduled_date}T${formData.scheduled_time}:00`)
    if (isNaN(startTimeObj.getTime())) {
      toast.error('Date ou heure invalide')
      return
    }

    const now = new Date()
    if (startTimeObj.getTime() <= now.getTime()) {
      toast.error("La date et l'heure doivent être postérieures à la date et heure actuelles")
      return
    }

    let endTimeObj: Date
    let endDateForSb: string | null = null
    // rental_period est une colonne générée par Postgres (GENERATED ALWAYS ... STORED)
    // à partir de booking_date/end_date : on ne l'écrit jamais, on la lit seulement
    // pour la vérification des conflits ci-dessous.
    let rentalPeriodLiteral: string | null = null

    if (formData.booking_kind === 'service') {
      const selectedService = services.find((s) => s.id === formData.service_id)
      const duration = parseDurationInMinutes(selectedService?.attributes?.duration)
      endTimeObj = new Date(startTimeObj.getTime() + duration * 60 * 1000)
    } else {
      endDateForSb = formData.end_date
      endTimeObj = new Date(`${formData.end_date}T${formData.scheduled_time}:00`)
      if (isNaN(endTimeObj.getTime()) || endTimeObj.getTime() < startTimeObj.getTime()) {
        toast.error('La date de fin doit être postérieure ou égale à la date de début')
        return
      }
      // Utilisé uniquement pour la requête .overlaps() de vérification de conflit,
      // jamais envoyé dans un insert/update.
      rentalPeriodLiteral = toDateRangeLiteral(formData.scheduled_date, formData.end_date)
    }

    setSaving(true)

    try {
      // ---- Vérification des conflits ----
      if (formData.booking_kind === 'service') {
        const { data: siblingSb, error: sbErr } = await supabase
          .from('service_bookings')
          .select('id, status')
          .eq('account_id', account.id)
          .eq('service_id', formData.service_id)
          .eq('status', 'confirmed') // service_bookings ne stocke jamais 'pending'

        if (sbErr) {
          console.error('Erreur vérification conflits:', sbErr)
        } else if (siblingSb && siblingSb.length > 0) {
          const siblingIds = siblingSb
            .map((sb) => sb.id)
            .filter((id) => !editingRdv || id !== editingRdv.service_booking_id)

          if (siblingIds.length > 0) {
            const { data: siblingBookings, error: bErr } = await supabase
              .from('bookings')
              .select('start_time, end_time')
              .in('bookable_item_id', siblingIds)

            if (bErr) console.error('Erreur vérification conflits bookings:', bErr)

            const newStart = startTimeObj.getTime()
            const newEnd = endTimeObj.getTime()
            for (const b of siblingBookings ?? []) {
              const existingStart = new Date(b.start_time).getTime()
              const existingEnd = new Date(b.end_time).getTime()
              if (newStart < existingEnd && newEnd > existingStart) {
                toast.error(
                  `Ce service est déjà réservé le ${formatDateShort(b.start_time)} sur ce créneau. Veuillez choisir un autre horaire.`
                )
                setSaving(false)
                return
              }
            }
          }
        }
      } else {
        let rangeQuery = supabase
          .from('service_bookings')
          .select('id')
          .eq('account_id', account.id)
          .eq('produit_id', formData.produit_id)
          .eq('status', 'confirmed') // service_bookings ne stocke jamais 'pending'
          .overlaps('rental_period', rentalPeriodLiteral as any)

        if (editingRdv?.service_booking_id) {
          rangeQuery = rangeQuery.neq('id', editingRdv.service_booking_id)
        }

        const { data: conflictingSb, error: rangeErr } = await rangeQuery

        if (rangeErr) {
          console.error('Erreur vérification conflits produit:', rangeErr)
        } else if (conflictingSb && conflictingSb.length > 0) {
          toast.error('Ce produit est déjà réservé sur une période qui chevauche ces dates.')
          setSaving(false)
          return
        }
      }

      // ---- 1. Écriture dans service_bookings ----
      const sbPayload: Record<string, any> = {
        account_id: account.id,
        service_id: formData.booking_kind === 'service' ? formData.service_id : null,
        produit_id: formData.booking_kind === 'produit' ? formData.produit_id : null,
        contact_phone: contact?.phone ?? '',
        contact_name: contact?.name ?? null,
        booking_date: formData.scheduled_date,
        end_date: endDateForSb,
        time_slot: formData.scheduled_time,
        // rental_period n'est PAS envoyé : colonne générée automatiquement par Postgres.
        status: toServiceBookingStatus(editingRdv ? editingRdv.status : 'pending'),
      }

      let serviceBookingId = editingRdv?.service_booking_id ?? null

      if (editingRdv && serviceBookingId) {
        const { error: sbUpdateErr } = await supabase
          .from('service_bookings')
          .update(sbPayload)
          .eq('id', serviceBookingId)
        if (sbUpdateErr) throw sbUpdateErr
      } else {
        const { data: sbInserted, error: sbInsertErr } = await supabase
          .from('service_bookings')
          .insert(sbPayload)
          .select('id')
          .single()
        if (sbInsertErr) throw sbInsertErr
        serviceBookingId = sbInserted.id
      }

      // ---- 2. Écriture dans bookings ----
      const nowIso = new Date().toISOString()
      const bookingPayload: Record<string, any> = {
        account_id: account.id,
        contact_id: formData.contact_id,
        bookable_item_id: serviceBookingId,
        bookable_item_source: 'service_bookings',
        start_time: startTimeObj.toISOString(),
        end_time: endTimeObj.toISOString(),
        attendee_name: contact?.name ?? null,
        attendee_phone: contact?.phone ?? null,
        raw_payload: formData.notes ? { notes: formData.notes } : null,
        ...(editingRdv
          ? { updated_at: nowIso }
          : { status: 'pending', created_at: nowIso, updated_at: nowIso }),
      }

      const { error: bookingErr } = editingRdv
        ? await supabase.from('bookings').update(bookingPayload).eq('id', editingRdv.id)
        : await supabase.from('bookings').insert(bookingPayload)

      if (bookingErr) {
        // Rollback : si on venait de créer le service_booking, on le supprime
        if (!editingRdv && serviceBookingId) {
          await supabase.from('service_bookings').delete().eq('id', serviceBookingId)
        }
        throw bookingErr
      }

      toast.success(editingRdv ? 'Rendez-vous modifié avec succès' : 'Rendez-vous créé avec succès')
      setFormOpen(false)
      setEditingRdv(null)
      setFormData(EMPTY_RDV_FORM)
      fetchRdv()
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || 'Erreur lors de la sauvegarde du rendez-vous')
    } finally {
      setSaving(false)
    }
  }

  // -------------------------------------------------------------------
  // Delete / Confirm / Cancel (répercutés sur bookings ET service_bookings)
  // -------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    try {
      const { error } = await supabase.from('bookings').delete().eq('id', deleteTarget.id)
      if (error) throw error

      if (deleteTarget.service_booking_id) {
        await supabase.from('service_bookings').delete().eq('id', deleteTarget.service_booking_id)
      }

      toast.success('Rendez-vous supprimé')
      setDeleteTarget(null)
      fetchRdv()
    } catch (err: any) {
      console.error('Erreur suppression:', err)
      toast.error(err?.message || 'Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  async function handleConfirm(rdv: RdvItem) {
    const nowIso = new Date().toISOString()
    await supabase.from('bookings').update({ status: 'confirmed', updated_at: nowIso }).eq('id', rdv.id)
    if (rdv.service_booking_id) {
      await supabase.from('service_bookings').update({ status: 'confirmed' }).eq('id', rdv.service_booking_id)
    }
    setRdvList((prev) => prev.map((r) => (r.id === rdv.id ? { ...r, status: 'confirmed' } : r)))
  }

  async function handleCancel(rdv: RdvItem) {
    const nowIso = new Date().toISOString()
    await supabase.from('bookings').update({ status: 'cancelled', updated_at: nowIso }).eq('id', rdv.id)
    if (rdv.service_booking_id) {
      await supabase.from('service_bookings').update({ status: 'cancelled' }).eq('id', rdv.service_booking_id)
    }
    setRdvList((prev) => prev.map((r) => (r.id === rdv.id ? { ...r, status: 'cancelled' } : r)))
  }

  // -------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------

  const stats = useMemo(() => ({
    confirmed: rdvList.filter((r) => r.status === 'confirmed').length,
    pending: rdvList.filter((r) => r.status === 'pending').length,
    cancelled: rdvList.filter((r) => r.status === 'cancelled').length,
    today: rdvList.filter((r) => isToday(r.start_time)).length,
  }), [rdvList])

  // -------------------------------------------------------------------
  // Filter + sort + group
  // -------------------------------------------------------------------

  const filtered = useMemo(() => {
    let list = rdvList.filter((r) => {
      const matchSearch =
        !search.trim() ||
        r.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        r.item_title.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'Toutes' || r.status === statusFilter
      return matchSearch && matchStatus
    })

    list = [...list].sort((a, b) =>
      sortOrder === 'asc'
        ? a.start_time.localeCompare(b.start_time)
        : b.start_time.localeCompare(a.start_time)
    )

    return list
  }, [rdvList, search, statusFilter, sortOrder])

  const grouped = useMemo(() => {
    const map = new Map<string, RdvItem[]>()
    for (const r of filtered) {
      const key = getDateKey(r.start_time)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [filtered])

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'Toutes', label: 'Toutes' },
    { value: 'confirmed', label: 'Confirmés' },
    { value: 'pending', label: 'En attente' },
    { value: 'cancelled', label: 'Annulés' },
    { value: 'completed', label: 'Terminés' },
  ]

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-col space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rendez-vous</h1>
          <p className="text-sm text-muted-foreground">
            {stats.today > 0
              ? `${stats.today} rendez-vous aujourd'hui`
              : "Aucun rendez-vous aujourd'hui"}
          </p>
        </div>
        <Button onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Nouveau rendez-vous
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Confirmés" value={stats.confirmed} color="bg-emerald-500" />
        <StatCard label="En attente" value={stats.pending} color="bg-amber-400" />
        <StatCard label="Annulés" value={stats.cancelled} color="bg-red-400" />
        <StatCard label="Aujourd'hui" value={stats.today} color="bg-primary" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher client, service ou produit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <ListFilter className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${statusFilter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortOrder((s) => (s === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {sortOrder === 'asc' ? 'Plus proche en premier' : 'Plus lointain en premier'}
          {sortOrder === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">
            {search || statusFilter !== 'Toutes'
              ? 'Aucun rendez-vous ne correspond aux filtres.'
              : 'Aucun rendez-vous pour le moment.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...grouped.entries()].map(([date, items]) => (
            <div key={date} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {isToday(date + 'T00:00:00') ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                      Aujourd'hui
                    </span>
                  ) : (
                    formatGroupDate(date)
                  )}
                </p>
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{items.length} rdv</span>
              </div>

              <div className="flex flex-col gap-2">
                {items.map((r) => (
                  <RdvRow
                    key={r.id}
                    rdv={r}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    onEdit={openEditModal}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Création / Modification de rendez-vous */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {editingRdv ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}
            </DialogTitle>
            <DialogDescription>
              {editingRdv
                ? 'Modifiez les détails du rendez-vous.'
                : 'Planifiez un rendez-vous de service ou une location de produit.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2 px-6 overflow-y-auto flex-1 min-h-0">
            {/* Type de réservation */}
            <div className="flex flex-col gap-2">
              <Label>Type de réservation *</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormData((f) => ({ ...f, booking_kind: 'service' }))}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${formData.booking_kind === 'service'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <Wrench className="h-4 w-4" />
                  Service
                </button>
                <button
                  type="button"
                  onClick={() => setFormData((f) => ({ ...f, booking_kind: 'produit' }))}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${formData.booking_kind === 'produit'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                >
                  <Package className="h-4 w-4" />
                  Produit
                </button>
              </div>
            </div>

            {/* Contact */}
            <div className="flex flex-col gap-2">
              <Label>Contact *</Label>
              <div className="rounded-lg border border-input bg-muted/20 p-2">
                <select
                  value={formData.contact_id}
                  onChange={(e) => setFormData((f) => ({ ...f, contact_id: e.target.value }))}
                  style={{ fontFamily: 'monospace' }}
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" hidden />
                  {contacts.map((c) => {
                    const name = c.name ?? ''
                    const phone = c.phone ?? ''
                    const label = phone ? name.padEnd(30, '\u00a0') + phone : name
                    return (
                      <option key={c.id} value={c.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            {/* Service (affiché uniquement si booking_kind === 'service') */}
            {formData.booking_kind === 'service' && (
              <div className="flex flex-col gap-2">
                <Label>Service *</Label>
                <div className="rounded-lg border border-input bg-muted/20 p-2">
                  <select
                    value={formData.service_id}
                    onChange={(e) => setFormData((f) => ({ ...f, service_id: e.target.value }))}
                    style={{ fontFamily: 'monospace' }}
                    className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" hidden />
                    {services.map((s) => {
                      const title = s.title ?? ''
                      const suffix = [
                        s.attributes?.duration ? `${s.attributes.duration}` : '',
                        s.price ? `${s.price}€` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                      const label = suffix ? title.padEnd(30, '\u00a0') + suffix : title
                      return (
                        <option key={s.id} value={s.id}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </div>
                {services.length === 0 && (
                  <p className="text-xs text-amber-600">⚠️ Aucun service trouvé.</p>
                )}
              </div>
            )}

            {/* Produit (affiché uniquement si booking_kind === 'produit') */}
            {formData.booking_kind === 'produit' && (
              <div className="flex flex-col gap-2">
                <Label>Produit *</Label>
                <div className="rounded-lg border border-input bg-muted/20 p-2">
                  <select
                    value={formData.produit_id}
                    onChange={(e) => setFormData((f) => ({ ...f, produit_id: e.target.value }))}
                    style={{ fontFamily: 'monospace' }}
                    className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="" hidden />
                    {produits.map((p) => {
                      const title = p.title ?? ''
                      const suffix = p.price ? `${p.price}€` : ''
                      const label = suffix ? title.padEnd(30, '\u00a0') + suffix : title
                      return (
                        <option key={p.id} value={p.id}>
                          {label}
                        </option>
                      )
                    })}
                  </select>
                </div>
                {produits.length === 0 && (
                  <p className="text-xs text-amber-600">⚠️ Aucun produit trouvé.</p>
                )}
              </div>
            )}

            {/* Date(s) + Heure */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label>{formData.booking_kind === 'produit' ? 'Date de début *' : 'Date *'}</Label>
                <Input
                  type="date"
                  min={todayStr}
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData((f) => ({ ...f, scheduled_date: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{formData.booking_kind === 'produit' ? 'Heure de prise en charge *' : 'Heure *'}</Label>
                <Input
                  type="time"
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData((f) => ({ ...f, scheduled_time: e.target.value }))}
                />
              </div>
            </div>

            {formData.booking_kind === 'produit' && (
              <div className="flex flex-col gap-2">
                <Label>Date de fin de location *</Label>
                <Input
                  type="date"
                  min={formData.scheduled_date || todayStr}
                  value={formData.end_date}
                  onChange={(e) => setFormData((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            )}

            {/* Notes */}
            <div className="flex flex-col gap-2">
              <Label>Notes</Label>
              <textarea
                rows={3}
                placeholder="Instructions particulières…"
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
          </div>

          <DialogFooter className="px-6 pb-6 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingRdv ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de suppression */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer le rendez-vous</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer ce rendez-vous ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
