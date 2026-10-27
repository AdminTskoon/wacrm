'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { uploadAccountMedia } from '@/lib/storage/upload-media'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Calendar,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Wrench,
  ExternalLink,
  Link2,
  MoreHorizontal,
  CheckCircle2,
  Upload,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ServiceRecord {
  id: string
  vertical: string | null
  booking_mode?: string | null
  title: string | null
  description?: string | null
  price: number | null
  currency?: string | null
  image_url?: string | null
  attributes?: Record<string, unknown> | string | null
  status?: string | null
  created_at?: string | null
  cal_event_slug?: string | null
  cal_username?: string | null
  is_active?: boolean | null
  active?: boolean | null
}

interface ServiceFormState {
  vertical: string
  booking_mode: string
  title: string
  description: string
  price: string
  image_url: string
  attributes: string
  status: string
  cal_event_slug: string
  cal_username: string
  duration_minutes: string
  sync_calcom: boolean
}

const EMPTY_FORM: ServiceFormState = {
  vertical: '',
  booking_mode: 'slot',
  title: '',
  description: '',
  price: '',
  image_url: '',
  attributes: '',
  status: 'active',
  cal_event_slug: '',
  cal_username: '',
  duration_minutes: '30',
  sync_calcom: true,
}

function fmtCurrency(value: number | null) {
  if (value == null) return '—'
  return value.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  })
}

function getServiceDuration(attributes: unknown): string | null {
  if (!attributes) return null
  let parsed = attributes
  if (typeof attributes === 'string') {
    try {
      parsed = JSON.parse(attributes)
    } catch {
      return null
    }
  }
  if (typeof parsed === 'object' && parsed !== null && 'duration' in parsed) {
    const val = (parsed as Record<string, unknown>).duration
    if (val != null && String(val).trim()) {
      return String(val).trim()
    }
  }
  return null
}

function extractDurationNumber(attributes: unknown): string {
  const dur = getServiceDuration(attributes)
  if (!dur) return '30'
  const match = dur.match(/\d+/)
  return match ? match[0] : '30'
}

function normalizeAttributes(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return null

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function getActiveValue(service: ServiceRecord) {
  if (typeof service.is_active === 'boolean') return service.is_active
  if (typeof service.active === 'boolean') return service.active

  const status = (service.status ?? '').toString().trim().toLowerCase()
  return status === 'active'
}

function getUpdatePayloadForActivation(service: ServiceRecord, active: boolean) {
  if ('is_active' in service) {
    return { is_active: active }
  }
  if ('active' in service) {
    return { active }
  }
  return { status: active ? 'active' : 'draft' }
}

export default function ServicesPage() {
  const supabase = useMemo(() => createClient(), [])
  const { accountId, defaultCurrency, account } = useAuth()
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRecord | null>(null)
  const [formData, setFormData] = useState<ServiceFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ServiceRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  // État de l'intégration Cal.com
  const [calcomStatus, setCalcomStatus] = useState<{
    configured: boolean
    username: string | null
    publicUrl: string
    eventTypes: { id: number; title: string; slug: string; length: number }[]
  } | null>(null)

  const fetchCalcomStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/calcom/event-types')
      if (res.ok) {
        const data = await res.json()
        setCalcomStatus(data)
      }
    } catch (e) {
      console.error('Failed to fetch Cal.com status:', e)
    }
  }, [])

  useEffect(() => {
    void fetchCalcomStatus()
  }, [fetchCalcomStatus])

  const fetchServices = useCallback(async () => {
    if (!accountId) {
      setServices([])
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from('services')
      .select('*')
      .eq('account_id', accountId)
      .order('vertical', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      console.error('Failed to fetch services:', error)
      toast.error('Erreur lors du chargement des services')
      setLoading(false)
      return
    }

    setServices((data ?? []) as ServiceRecord[])
    setLoading(false)
  }, [accountId, supabase])

  useEffect(() => {
    void fetchServices()
  }, [fetchServices])

  function setField<K extends keyof ServiceFormState>(key: K, value: ServiceFormState[K]) {
    setFormData((current) => ({ ...current, [key]: value }))
  }

  async function handleImageFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner un fichier image valide')
      return
    }

    setUploadingImage(true)
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file)
      setField('image_url', publicUrl)
      toast.success('Photo téléversée avec succès')
    } catch (err: any) {
      console.error('Erreur upload photo:', err)
      toast.error(err?.message || 'Erreur lors du téléversement de la photo')
    } finally {
      setUploadingImage(false)
      e.target.value = ''
    }
  }

  function openCreateModal() {
    setEditingService(null)
    setFormData({
      ...EMPTY_FORM,
      cal_username: calcomStatus?.username || 'GASy',
      sync_calcom: calcomStatus?.configured ?? true,
    })
    setFormOpen(true)
  }

  function openEditModal(service: ServiceRecord) {
    setEditingService(service)
    const dur = extractDurationNumber(service.attributes)
    setFormData({
      vertical: service.vertical ?? '',
      booking_mode: service.booking_mode ?? 'appointment',
      title: service.title ?? '',
      description: service.description ?? '',
      price: service.price != null ? String(service.price) : '',
      image_url: service.image_url ?? '',
      attributes:
        typeof service.attributes === 'string'
          ? service.attributes
          : service.attributes
            ? JSON.stringify(service.attributes, null, 2)
            : '',
      status: service.status ?? 'active',
      cal_event_slug: service.cal_event_slug ?? '',
      cal_username: service.cal_username ?? calcomStatus?.username ?? 'GASy',
      duration_minutes: dur,
      sync_calcom: Boolean(calcomStatus?.configured && service.cal_event_slug),
    })
    setFormOpen(true)
  }

  async function handleSave() {
    const title = formData.title.trim()
    const vertical = formData.vertical.trim()
    const price = Number(formData.price)

    if (!accountId) {
      toast.error('Aucun compte actif')
      return
    }

    if (!title) {
      toast.error('Le titre du service est requis')
      return
    }

    if (!vertical) {
      toast.error('La vertical est requise')
      return
    }

    if (!Number.isFinite(price)) {
      toast.error('Le prix doit être un nombre valide')
      return
    }

    setSaving(true)
    try {
      let resolvedSlug = formData.cal_event_slug.trim()
      let resolvedUsername = formData.cal_username.trim() || calcomStatus?.username || 'GASy'

      // Synchronisation avec Cal.com si activée
      if (formData.sync_calcom) {
        const calRes = await fetch('/api/calcom/event-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            slug: resolvedSlug || undefined,
            existingSlug: editingService?.cal_event_slug || undefined,
            length: Number(formData.duration_minutes) || 30,
            description: formData.description.trim() || undefined,
          }),
        })

        const calData = await calRes.json().catch(() => null)
        if (!calRes.ok || !calData?.ok) {
          const rawErr = calData?.error || calData?.message || calRes.statusText
          const errMsg =
            typeof rawErr === 'string'
              ? rawErr
              : typeof rawErr?.message === 'string'
                ? rawErr.message
                : JSON.stringify(rawErr)
          throw new Error(errMsg || 'Erreur lors de la synchronisation avec Cal.com')
        }

        resolvedSlug = calData.slug || resolvedSlug
        resolvedUsername = calData.username || resolvedUsername
      }

      // Formatage des attributs avec la durée
      let attrObj: Record<string, unknown> = {}
      if (formData.attributes.trim()) {
        try {
          const parsed = JSON.parse(formData.attributes.trim())
          if (typeof parsed === 'object' && parsed !== null) {
            attrObj = parsed
          }
        } catch {
          // Si chaîne brute non-JSON, on l'ignore
        }
      }
      if (formData.duration_minutes) {
        attrObj.duration = `${formData.duration_minutes} min`
      }
      const finalAttributes =
        Object.keys(attrObj).length > 0 ? attrObj : normalizeAttributes(formData.attributes)

      const payload = {
        account_id: accountId,
        vertical: vertical || null,
        booking_mode: formData.booking_mode.trim() || null,
        title: title || null,
        description: formData.description.trim() || null,
        price,
        currency: defaultCurrency || account?.default_currency || 'EUR',
        image_url: formData.image_url.trim() || null,
        attributes: finalAttributes,
        status: formData.status.trim() || 'active',
        cal_event_slug: resolvedSlug || null,
        cal_username: resolvedUsername || null,
        ...(editingService ? {} : { created_at: new Date().toISOString() }),
      }

      const { error } = editingService
        ? await supabase
          .from('services')
          .update(payload)
          .eq('id', editingService.id)
          .eq('account_id', accountId)
        : await supabase.from('services').insert([payload])

      if (error) throw error

      toast.success(
        formData.sync_calcom
          ? editingService
            ? 'Service mis à jour et synchronisé dans Cal.com !'
            : 'Service créé et synchronisé avec Cal.com !'
          : editingService
            ? 'Service mis à jour'
            : 'Service ajouté'
      )
      setFormOpen(false)
      setEditingService(null)
      setFormData(EMPTY_FORM)
      await fetchServices()
      void fetchCalcomStatus()
    } catch (error: any) {
      console.error('Service save error:', error)
      const errText =
        typeof error?.message === 'string'
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error)
      toast.error(
        errText ||
        (editingService
          ? 'Erreur lors de la mise à jour du service'
          : 'Erreur lors de l’ajout du service')
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget || !accountId) return
    setDeleting(true)
    try {
      // 1. Cal.com d'abord (si le service y est lié)
      if (deleteTarget.cal_event_slug) {
        const res = await fetch('/api/calcom/event-types', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: deleteTarget.cal_event_slug }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.ok) {
          throw new Error(
            typeof data?.error === 'string' ? data.error : 'Suppression dans Cal.com impossible'
          )
        }
      }

      // 2. Puis Supabase
      const { error } = await supabase
        .from('services')
        .delete()
        .eq('id', deleteTarget.id)
        .eq('account_id', accountId)
      if (error) throw error

      toast.success('Service supprimé')
      setDeleteTarget(null)
      await fetchServices()
      void fetchCalcomStatus()
    } catch (error: any) {
      console.error('Service delete error:', error)
      toast.error(error?.message || 'Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  async function toggleService(service: ServiceRecord) {
    const nextValue = !getActiveValue(service)
    setTogglingId(service.id)

    try {
      const { error } = await supabase
        .from('services')
        .update(getUpdatePayloadForActivation(service, nextValue))
        .eq('id', service.id)

      if (error) throw error

      toast.success(nextValue ? 'Service activé' : 'Service désactivé')
      await fetchServices()
    } catch (error: any) {
      console.error('Service toggle error:', error)
      toast.error(error?.message || 'Erreur lors du changement de statut')
    } finally {
      setTogglingId(null)
    }
  }

  const verticalOptions = Array.from(
    new Set(
      services
        .map((service) => service.vertical)
        .filter((value): value is string => Boolean(value && value.trim()))
    )
  ).sort((a, b) => a.localeCompare(b))

  const groupedServices = services.reduce<Record<string, ServiceRecord[]>>((acc, service) => {
    const vertical = (service.vertical ?? '').toString().trim() || 'Autre'
    if (!acc[vertical]) acc[vertical] = []
    acc[vertical].push(service)
    return acc
  }, {})

  return (
    <div className="flex flex-col space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Services</h1>
          <p className="text-sm text-muted-foreground">
            Gérez vos prestations et synchronisez automatiquement les créneaux avec Cal.com.
          </p>
        </div>
        <Button type="button" onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Ajouter un service
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des services…
          </div>
        </div>
      ) : services.length === 0 ? (
        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card p-8 text-center text-muted-foreground">
          <Wrench className="mb-3 h-8 w-8 opacity-50" />
          <p>Aucun service disponible pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedServices).map(([vertical, items]) => (
            <div
              key={vertical}
              className="rounded-xl border border-border bg-card shadow-sm overflow-hidden"
            >
              <div className="border-b border-border px-4 py-3">
                <h2 className="text-lg font-semibold text-foreground">{vertical}</h2>
                <p className="text-sm text-muted-foreground">
                  {items.length} service{items.length > 1 ? 's' : ''}
                </p>
              </div>

              <div className="divide-y divide-border/60">
                {items.map((service) => {
                  const active = getActiveValue(service)
                  const duration = getServiceDuration(service.attributes)
                  const publicBase = calcomStatus?.publicUrl || 'https://cal.com'
                  const calUrl =
                    service.cal_username && service.cal_event_slug
                      ? `${publicBase}/${service.cal_username}/${service.cal_event_slug}`
                      : service.cal_event_slug
                        ? `${publicBase}/${service.cal_event_slug}`
                        : null

                  return (
                    <div
                      key={service.id}
                      className="flex items-center justify-between gap-4 px-4 py-4"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <p className="font-semibold text-foreground">
                            {service.title || 'Sans titre'}
                          </p>
                          {service.price != null && (
                            <span className="text-sm font-medium text-foreground/90">
                              {fmtCurrency(service.price)}
                            </span>
                          )}
                          {service.cal_event_slug && (
                            <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                              <Calendar className="h-3 w-3" />
                              Cal: {service.cal_event_slug}
                            </span>
                          )}
                        </div>
                        {duration && (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground/80">
                            <Clock className="h-3.5 w-3.5" />
                            {duration.includes('min') ||
                              duration.includes('h') ||
                              duration.endsWith('m')
                              ? duration
                              : `${duration}m`}
                          </span>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {/* Interrupteur actif/inactif */}
                        <button
                          type="button"
                          role="switch"
                          aria-checked={active}
                          onClick={() => void toggleService(service)}
                          disabled={togglingId === service.id}
                          className={[
                            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60',
                            active ? 'bg-primary' : 'bg-muted',
                          ].join(' ')}
                        >
                          <span
                            className={[
                              'inline-block h-5 w-5 transform rounded-full bg-primary-foreground shadow transition-transform',
                              active ? 'translate-x-5' : 'translate-x-0.5',
                            ].join(' ')}
                          />
                        </button>

                        {/* Groupe d'actions icônes */}
                        <div className="flex items-center gap-1 rounded-md border border-border p-1">
                          <button
                            type="button"
                            title={
                              calUrl
                                ? 'Ouvrir la page de réservation Cal.com'
                                : 'Aucun lien Cal.com configuré'
                            }
                            onClick={() => {
                              if (calUrl) {
                                window.open(calUrl, '_blank', 'noopener,noreferrer')
                              } else {
                                toast.info('Aucun slug Cal.com associé à ce service')
                              }
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="Copier le lien Cal.com"
                            onClick={() => {
                              if (calUrl) {
                                navigator.clipboard?.writeText(calUrl)
                                toast.success('Lien Cal.com copié')
                              } else {
                                toast.info('Aucun slug Cal.com associé à ce service')
                              }
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Link2 className="h-4 w-4" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  type="button"
                                  className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                />
                              }
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditModal(service)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Modifier
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(service)}
                                className="text-red-500 focus:text-red-500"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Supprimer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Création / Modification */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingService ? 'Modifier le service' : 'Ajouter un service'}
            </DialogTitle>
            <DialogDescription>
              {editingService
                ? 'Modifiez les informations du service et synchronisez vos mises à jour avec Cal.com.'
                : 'Créez un service. Il sera automatiquement généré dans Cal.com si la synchronisation est activée.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2 md:grid-cols-2">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-vertical">Vertical / Catégorie</Label>
              <Input
                id="service-vertical"
                list="service-vertical-options"
                value={formData.vertical}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, vertical: event.target.value }))
                }
                placeholder="Ex. Salon, Beauté, Consultation"
              />
              <datalist id="service-vertical-options">
                {verticalOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-booking-mode">Mode de réservation</Label>
              <Input
                id="service-booking-mode"
                value={formData.booking_mode}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, booking_mode: event.target.value }))
                }
                placeholder="appointment"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-title">Titre du service *</Label>
              <Input
                id="service-title"
                value={formData.title}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="Ex. Coupe curly, Soin visage, etc."
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="service-description">Description</Label>
              <textarea
                id="service-description"
                value={formData.description}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Décrivez le service"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-price">Prix</Label>
              <Input
                id="service-price"
                type="number"
                min="0"
                step="0.01"
                value={formData.price}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, price: event.target.value }))
                }
                placeholder="0"
              />
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-duration">Durée (minutes)</Label>
              <div className="flex gap-2">
                <Input
                  id="service-duration"
                  type="number"
                  min="5"
                  step="5"
                  value={formData.duration_minutes}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      duration_minutes: event.target.value,
                    }))
                  }
                  placeholder="30"
                  className="w-full"
                />
                <div className="flex gap-1 shrink-0">
                  {['15', '30', '45', '60'].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() =>
                        setFormData((c) => ({ ...c, duration_minutes: mins }))
                      }
                      className={`px-2 py-1 text-xs rounded border transition-colors ${formData.duration_minutes === mins
                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                        : 'bg-muted/50 hover:bg-muted text-muted-foreground border-border'
                        }`}
                    >
                      {mins}m
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="f-image-file">Photo du service (optionnel)</Label>

              {formData.image_url ? (
                <div className="flex items-center gap-3 p-3 rounded-lg border border-input bg-muted/20">
                  <div className="relative h-16 w-16 rounded-md overflow-hidden border border-border bg-background shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={formData.image_url}
                      alt="Aperçu du service"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground truncate">{formData.image_url}</span>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-primary hover:underline cursor-pointer">
                        Changer la photo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleImageFileUpload}
                          disabled={uploadingImage}
                        />
                      </label>
                      <span className="text-xs text-muted-foreground">•</span>
                      <button
                        type="button"
                        onClick={() => setField('image_url', '')}
                        className="text-xs font-medium text-red-500 hover:underline"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-input hover:border-primary/50 rounded-lg p-4 cursor-pointer bg-muted/10 hover:bg-muted/20 transition-colors">
                    {uploadingImage ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        <span>Téléversement de la photo…</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-center">
                        <Upload className="h-6 w-6 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                          Sélectionner une photo depuis un fichier
                        </span>
                        <span className="text-xs text-muted-foreground">PNG, JPG, WEBP jusqu'à 16 Mo</span>
                      </div>
                    )}
                    <input
                      id="f-image-file"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageFileUpload}
                      disabled={uploadingImage}
                    />
                  </label>
                  <Input
                    id="f-image-url"
                    placeholder="Ou coller une URL d'image externe (https://…)"
                    value={formData.image_url}
                    onChange={(e) => setField('image_url', e.target.value)}
                    className="text-xs h-8"
                  />
                </div>
              )}
            </div>

            {/* Bloc Intégration Cal.com */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 md:col-span-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    Synchronisation Cal.com
                  </span>
                  {calcomStatus?.configured && (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      Connecté
                    </span>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={formData.sync_calcom}
                    onChange={(e) =>
                      setFormData((c) => ({ ...c, sync_calcom: e.target.checked }))
                    }
                    className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                  />
                  <span>
                    {editingService
                      ? 'Mettre à jour aussi dans Cal.com'
                      : 'Créer automatiquement dans Cal.com'}
                  </span>
                </label>
              </div>

              {!calcomStatus?.configured && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                  ℹ️ Clé API Cal.com non encore renseignée dans <code>.env.local</code> (<code>CAL_API_KEY</code>). Dès que vous collez votre clé, la synchronisation s'activera automatiquement.
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="service-cal-event" className="text-xs">
                    {formData.sync_calcom
                      ? "Slug d'événement (généré si vide)"
                      : 'Cal event slug'}
                  </Label>
                  <Input
                    id="service-cal-event"
                    value={formData.cal_event_slug}
                    onChange={(event) =>
                      setFormData((current) => ({
                        ...current,
                        cal_event_slug: event.target.value,
                      }))
                    }
                    placeholder={formData.sync_calcom ? 'Auto-généré (ex: curly)' : 'ex: curly'}
                    className="h-9 text-xs"
                  />

                  {calcomStatus?.eventTypes &&
                    calcomStatus.eventTypes.length > 0 &&
                    !formData.sync_calcom && (
                      <select
                        className="mt-1.5 h-8 w-full rounded border border-input bg-background px-2 text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        onChange={(e) => {
                          if (e.target.value) {
                            const selected = calcomStatus.eventTypes.find(
                              (et) => et.slug === e.target.value
                            )
                            setFormData((c) => ({
                              ...c,
                              cal_event_slug: e.target.value,
                              duration_minutes: selected?.length
                                ? String(selected.length)
                                : c.duration_minutes,
                            }))
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">-- Ou choisir un événement Cal.com existant --</option>
                        {calcomStatus.eventTypes.map((et) => (
                          <option key={et.id} value={et.slug}>
                            {et.title} ({et.slug} · {et.length} min)
                          </option>
                        ))}
                      </select>
                    )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="service-cal-username" className="text-xs">
                    Cal.com Nom d'utilisateur
                  </Label>
                  <Input
                    id="service-cal-username"
                    value={formData.cal_username}
                    onChange={(event) =>
                      setFormData((current) => ({
                        ...current,
                        cal_username: event.target.value,
                      }))
                    }
                    placeholder="ex: GASy"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="service-status">Statut</Label>
              <select
                id="service-status"
                value={formData.status}
                onChange={(event) =>
                  setFormData((current) => ({ ...current, status: event.target.value }))
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="active">Actif</option>
                <option value="draft">Brouillon</option>
                <option value="archived">Archivé</option>
              </select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving
                ? 'Enregistrement…'
                : editingService
                  ? 'Enregistrer les modifications'
                  : 'Créer le service'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le service</DialogTitle>
            <DialogDescription>
              Voulez-vous supprimer{' '}
              <strong className="text-foreground">{deleteTarget?.title ?? 'ce service'}</strong> ?
              {deleteTarget?.cal_event_slug && ' Il sera aussi supprimé de Cal.com.'}{' '}
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleDelete()} disabled={deleting} className="gap-2">
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Version "en direct" : garde le tiret final pendant la saisie
function slugifyLive(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // espaces et caractères spéciaux → tiret
    .replace(/^-+/, '')
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // retire les accents
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // espaces et symboles → tiret
    .replace(/^-+|-+$/g, '')
}
