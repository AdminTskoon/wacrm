'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { normalizeInventory } from '@/lib/inventory'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Package,
  ChevronLeft,
  ChevronRight,
  Tag,
  Upload,
  ImageIcon,
} from 'lucide-react';
import { ImportModal } from '@/components/produits/import-modal';
import { GatedButton } from '@/components/ui/gated-button';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Produit {
  id: string
  title: string | null
  availability: string | null
  image_url: string | null
  quantity: number | null
  price: number | null
  sale_price: number | null
  sale_price_starts_at: string | null
  sale_price_ends_at: string | null
  [key: string]: any
}

interface ProduitFormData {
  // Infos générales
  vertical: string
  external_id: string
  title: string
  description: string
  status: string
  // Médias & URL
  url: string
  image_url: string
  additional_image_urls: string
  videos: string          // JSON textarea
  // Prix
  price: string
  currency: string
  sale_price: string
  sale_price_starts_at: string
  sale_price_ends_at: string
  rental_price: string
  booking_mode: string
  // Inventaire
  quantity: string
  availability: string
  condition: string
  // Identifiants produit
  brand: string
  gtin: string
  google_product_category: string
  fb_product_category: string
  item_group_id: string
  // Caractéristiques
  gender: string
  color: string
  size: string
  age_group: string
  material: string
  pattern: string
  style: string           // comma-separated → text[]
  // Livraison
  shipping: string        // JSON textarea
  shipping_weight_value: string
  shipping_weight_unit: string
  // Offre
  offer_disclaimer: string
  offer_disclaimer_url: string
  // Tags & Attributs
  product_tags: string    // comma-separated → text[]
  attributes: string      // JSON textarea
  for_sale: string
  for_rent: string
}

const EMPTY_FORM: ProduitFormData = {
  vertical: '',
  external_id: '',
  title: '',
  description: '',
  status: 'active',
  url: '',
  image_url: '',
  additional_image_urls: '',
  videos: '',
  price: '',
  currency: '',
  sale_price: '',
  sale_price_starts_at: '',
  sale_price_ends_at: '',
  rental_price: '',
  booking_mode: '',
  quantity: '',
  availability: '',
  condition: '',
  brand: '',
  gtin: '',
  google_product_category: '',
  fb_product_category: '',
  item_group_id: '',
  gender: '',
  color: '',
  size: '',
  age_group: '',
  material: '',
  pattern: '',
  style: '',
  shipping: '',
  shipping_weight_value: '',
  shipping_weight_unit: '',
  offer_disclaimer: '',
  offer_disclaimer_url: '',
  product_tags: '',
  attributes: '',
  for_sale: 'true',
  for_rent: 'false',
}

const PAGE_SIZE = 25

// ---------------------------------------------------------------------------
// Helper — parse optional JSON textarea
// ---------------------------------------------------------------------------
function parseJsonField(raw: string): object | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helper — parse comma-separated list
// ---------------------------------------------------------------------------
function parseTags(raw: string): string[] | null {
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

function isSalePriceActive(produit: Produit) {
  const now = new Date()
  const startsAt = produit.sale_price_starts_at ? new Date(produit.sale_price_starts_at) : null
  const endsAt = produit.sale_price_ends_at ? new Date(produit.sale_price_ends_at) : null

  if (startsAt && endsAt) {
    return startsAt <= now && now <= endsAt
  }

  if (startsAt) {
    return now >= startsAt
  }

  if (endsAt) {
    return now <= endsAt
  }

  return false
}

function getCurrentDisplayPrice(produit: Produit) {
  if (isSalePriceActive(produit) && produit.sale_price != null) {
    return produit.sale_price
  }

  return produit.price ?? null
}

// ---------------------------------------------------------------------------
// Section header helper component
// ---------------------------------------------------------------------------
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProduitsPage() {
  const supabase = createClient()
  const { account, canEditSettings, defaultCurrency } = useAuth()

  // Data
  const [produits, setProduits] = useState<Produit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Modal state
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false)
  const [editingProduit, setEditingProduit] = useState<Produit | null>(null)
  const [formData, setFormData] = useState<ProduitFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingUrl, setUploadingUrl] = useState(false)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Produit | null>(null)
  const [deleting, setDeleting] = useState(false)

  // States pour le dropdown Google Product Category
  const [gpcLevel1Options, setGpcLevel1Options] = useState<string[]>([])
  const [gpcLevel2Options, setGpcLevel2Options] = useState<string[]>([])
  const [gpcLevel3Options, setGpcLevel3Options] = useState<{ label: string, full_path: string }[]>([])
  const [gpcLevel1, setGpcLevel1] = useState('')
  const [gpcLevel2, setGpcLevel2] = useState('')

  // States pour le dropdown facebook Product Category
  const [fbpcLevel1Options, setFbpcLevel1Options] = useState<string[]>([])
  const [fbpcLevel2Options, setFbpcLevel2Options] = useState<string[]>([])
  const [fbpcLevel3Options, setFbpcLevel3Options] = useState<{ label: string, full_path: string }[]>([])
  const [fbpcLevel1, setFbpcLevel1] = useState('')
  const [fbpcLevel2, setFbpcLevel2] = useState('')


  // -------------------------------------------------------------------
  // Fetch (table only needs 5 display columns)
  // -------------------------------------------------------------------

  const fetchProduits = useCallback(async () => {
    setLoading(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    let query = supabase
      .from('produits')
      .select('*', { count: 'exact' })
      .order('title', { ascending: true })
      .range(from, to)

    if (search.trim()) {
      query = query.ilike('title', `%${search.trim()}%`)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Failed to fetch produits:', error)
      toast.error('Erreur lors du chargement des produits')
    } else {
      setProduits((data ?? []) as Produit[])
      setTotalCount(count ?? 0)
    }
    setLoading(false)
  }, [supabase, page, search])

  useEffect(() => {
    fetchProduits()
  }, [fetchProduits])

  useEffect(() => {
    setPage(0)
  }, [search])

  useEffect(() => {
    async function fetchLevel1() {
      const { data, error } = await supabase
        .from('google_product_categories')
        .select('level_1')
        .not('level_1', 'is', null)
        .order('level_1')

      if (error) {
        console.error('Erreur chargement google_product_categories (niveau 1):', error)
      }

      const unique = [...new Set((data ?? []).map((d: any) => d.level_1).filter(Boolean))]
      setGpcLevel1Options(unique)
    }
    fetchLevel1()
  }, [supabase])

  useEffect(() => {
    if (!gpcLevel1) return
    async function fetchLevel2() {
      const { data, error } = await supabase
        .from('google_product_categories')
        .select('level_2')
        .eq('level_1', gpcLevel1)
        .not('level_2', 'is', null)
        .order('level_2')

      if (error) {
        console.error('Erreur chargement google_product_categories (niveau 2):', error)
      }

      const unique = [...new Set((data ?? []).map((d: any) => d.level_2).filter(Boolean))]
      setGpcLevel2Options(unique)
      setGpcLevel2('')
      if (unique.length === 0) {
        setField('google_product_category', gpcLevel1)
      }
    }
    fetchLevel2()
  }, [gpcLevel1, supabase])

  useEffect(() => {
    if (!gpcLevel1 || !gpcLevel2) return
    async function fetchLevel3() {
      const { data, error } = await supabase
        .from('google_product_categories')
        .select('level_3, full_path')
        .eq('level_1', gpcLevel1)
        .eq('level_2', gpcLevel2)
        .not('level_3', 'is', null)
        .order('level_3')

      if (error) {
        console.error('Erreur chargement google_product_categories (niveau 3):', error)
      }

      const opts = (data ?? []).map((d: any) => ({
        label: d.level_3,
        full_path: d.full_path
      }))
      setGpcLevel3Options(opts)
      // Si aucun niveau 3 → l'ensemble des valeurs est le chemin complet niveau 1 > niveau 2
      if (opts.length === 0) {
        const fullVal = (data?.[0]?.full_path) || [gpcLevel1, gpcLevel2].filter(Boolean).join(' > ')
        setField('google_product_category', fullVal)
      }
    }
    fetchLevel3()
  }, [gpcLevel1, gpcLevel2, supabase])

  useEffect(() => {
    async function fetchLevel1() {
      const { data, error } = await supabase
        .from('fb_product_categories')
        .select('level_1')
        .not('level_1', 'is', null)
        .order('level_1')

      if (error) {
        console.error('Erreur chargement fb_product_categories (niveau 1):', error)
      }

      const unique = [...new Set((data ?? []).map((d: any) => d.level_1).filter(Boolean))]
      setFbpcLevel1Options(unique)
    }
    fetchLevel1()
  }, [supabase])

  useEffect(() => {
    if (!fbpcLevel1) return
    async function fetchLevel2() {
      const { data, error } = await supabase
        .from('fb_product_categories')
        .select('level_2')
        .eq('level_1', fbpcLevel1)
        .not('level_2', 'is', null)
        .order('level_2')

      if (error) {
        console.error('Erreur chargement fb_product_categories (niveau 2):', error)
      }

      const unique = [...new Set((data ?? []).map((d: any) => d.level_2).filter(Boolean))]
      setFbpcLevel2Options(unique)
      setFbpcLevel2('')
      if (unique.length === 0) {
        setField('fb_product_category', fbpcLevel1)
      }
    }
    fetchLevel2()
  }, [fbpcLevel1, supabase])

  useEffect(() => {
    if (!fbpcLevel1 || !fbpcLevel2) return
    async function fetchLevel3() {
      const { data, error } = await supabase
        .from('fb_product_categories')
        .select('level_3, full_path')
        .eq('level_1', fbpcLevel1)
        .eq('level_2', fbpcLevel2)
        .not('level_3', 'is', null)
        .order('level_3')

      if (error) {
        console.error('Erreur chargement fb_product_categories (niveau 3):', error)
      }

      const opts = (data ?? []).map((d: any) => ({
        label: d.level_3,
        full_path: d.full_path
      }))
      setFbpcLevel3Options(opts)
      // Si aucun niveau 3 → l'ensemble des valeurs est le chemin complet niveau 1 > niveau 2
      if (opts.length === 0) {
        const fullVal = (data?.[0]?.full_path) || [fbpcLevel1, fbpcLevel2].filter(Boolean).join(' > ')
        setField('fb_product_category', fullVal)
      }
    }
    fetchLevel3()
  }, [fbpcLevel1, fbpcLevel2, supabase])

  // -------------------------------------------------------------------
  // Short helper to update a single form field
  // -------------------------------------------------------------------
  function setField<K extends keyof ProduitFormData>(key: K, value: ProduitFormData[K]) {
    setFormData((f) => ({ ...f, [key]: value }))
  }

  // -------------------------------------------------------------------
  // Create / Update
  // -------------------------------------------------------------------

  function openCreateModal() {
    setEditingProduit(null)
    setFormData({
      ...EMPTY_FORM,
      currency: defaultCurrency || account?.default_currency || 'USD',
    })
    setFormOpen(true)
  }

  function openEditModal(produit: Produit) {
    setEditingProduit(produit)
    // Only pre-fill the fields that come from the table query;
    // the rest stay empty and can be filled in freely.
    setFormData({
      vertical: produit.vertical ?? '',
      external_id: produit.external_id ?? '',
      title: produit.title ?? '',
      description: produit.description ?? '',
      status: produit.status ?? 'active',
      url: produit.url ?? '',
      image_url: produit.image_url ?? '',
      additional_image_urls: Array.isArray(produit.additional_image_urls) ? produit.additional_image_urls.join(', ') : (produit.additional_image_urls ?? ''),
      videos: typeof produit.videos === 'string' ? produit.videos : produit.videos ? JSON.stringify(produit.videos, null, 2) : '',
      price: produit.price != null ? String(produit.price) : '',
      currency: produit.currency || defaultCurrency || account?.default_currency || 'USD',
      sale_price: produit.sale_price != null ? String(produit.sale_price) : '',
      sale_price_starts_at: produit.sale_price_starts_at ? new Date(produit.sale_price_starts_at).toISOString().slice(0, 16) : '',
      sale_price_ends_at: produit.sale_price_ends_at ? new Date(produit.sale_price_ends_at).toISOString().slice(0, 16) : '',
      rental_price: produit.rental_price != null ? String(produit.rental_price) : '',
      booking_mode: produit.booking_mode ?? '',
      quantity: produit.quantity != null ? String(produit.quantity) : '',
      availability: produit.availability ?? '',
      condition: produit.condition ?? '',
      brand: produit.brand ?? '',
      gtin: produit.gtin ?? '',
      google_product_category: produit.google_product_category ?? '',
      fb_product_category: produit.fb_product_category ?? '',
      item_group_id: produit.item_group_id ?? '',
      gender: produit.gender ?? '',
      color: produit.color ?? '',
      size: produit.size ?? '',
      age_group: produit.age_group ?? '',
      material: produit.material ?? '',
      pattern: produit.pattern ?? '',
      style: Array.isArray(produit.style) ? produit.style.join(', ') : (produit.style ?? ''),
      shipping: typeof produit.shipping === 'string' ? produit.shipping : produit.shipping ? JSON.stringify(produit.shipping, null, 2) : '',
      shipping_weight_value: produit.shipping_weight_value != null ? String(produit.shipping_weight_value) : '',
      shipping_weight_unit: produit.shipping_weight_unit ?? '',
      offer_disclaimer: produit.offer_disclaimer ?? '',
      offer_disclaimer_url: produit.offer_disclaimer_url ?? '',
      product_tags: Array.isArray(produit.product_tags) ? produit.product_tags.join(', ') : (produit.product_tags ?? ''),
      attributes: typeof produit.attributes === 'string' ? produit.attributes : produit.attributes ? JSON.stringify(produit.attributes, null, 2) : '',
      for_sale: produit.for_sale ? 'true' : 'false',
      for_rent: produit.for_rent ? 'true' : 'false',
    })
    setFormOpen(true)
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

  async function handleUrlFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Veuillez sélectionner un fichier image valide')
      return
    }

    setUploadingUrl(true)
    try {
      const { publicUrl } = await uploadAccountMedia('chat-media', file)
      setField('url', publicUrl)
      toast.success('Image pour l\'URL produit téléversée avec succès')
    } catch (err: any) {
      console.error('Erreur upload fichier url:', err)
      toast.error(err?.message || 'Erreur lors du téléversement du fichier')
    } finally {
      setUploadingUrl(false)
      e.target.value = ''
    }
  }

  async function handleSave() {
    if (!formData.title.trim()) {
      toast.error('Le titre du produit est requis')
      return
    }

    if (!formData.description.trim()) {
      toast.error('La description du produit est requise')
      return
    }

    if (!formData.vertical.trim()) {
      toast.error('Le vertical du produit est requis')
      return
    }

    if (!formData.external_id.trim()) {
      toast.error("L'ID externe est requis")
      return
    }

    if (!formData.price.trim()) {
      toast.error('Le prix du produit est requis')
      return
    }

    if (!formData.condition.trim()) {
      toast.error('La condition du produit est requise')
      return
    }

    if (!formData.brand.trim()) {
      toast.error('La marque est requise')
      return
    }

    if (formData.for_sale === 'true') {
      if (!formData.image_url.trim()) {
        toast.error("La photo / URL de l'image est requise lorsque le produit est à vendre")
        return
      }
      if (!formData.url.trim()) {
        toast.error("L'URL du produit est requise lorsque le produit est à vendre")
        return
      }
    }

    // Numeric conversions
    const price = formData.price ? parseFloat(formData.price) : null
    const sale_price = formData.sale_price ? parseFloat(formData.sale_price) : null
    const rental_price = formData.rental_price ? parseFloat(formData.rental_price) : null
    const quantity = formData.quantity ? parseInt(formData.quantity, 10) : null
    const shipping_weight_value = formData.shipping_weight_value
      ? parseFloat(formData.shipping_weight_value)
      : null

    const normalizedInventory = normalizeInventory(quantity, formData.availability)
    const resolvedAvailability = normalizedInventory.quantity > 0 ? 'in stock' : 'out of stock'

    // JSON fields
    const shipping = parseJsonField(formData.shipping)
    const videos = parseJsonField(formData.videos)
    const attributes = parseJsonField(formData.attributes)

    // Array fields
    const product_tags = parseTags(formData.product_tags)
    const style = parseTags(formData.style)
    const additional_image_urls = parseTags(formData.additional_image_urls)

    setSaving(true)

    const payload = {
      // Infos générales
      vertical: formData.vertical.trim() || 'default',
      external_id: formData.external_id.trim() || `ext-${Date.now()}`,
      title: formData.title.trim(),
      description: formData.description.trim() || '',
      status: formData.status.trim() || 'active',
      // Fixed values
      for_sale: formData.for_sale === 'true',
      for_rent: formData.for_rent === 'true',
      // Médias & URL
      url: formData.url.trim() || null,
      image_url: formData.image_url.trim() || null,
      additional_image_urls: additional_image_urls || [],
      videos: videos || [],
      // Prix
      price: price || 0,
      currency: formData.currency?.trim() || defaultCurrency || account?.default_currency || 'USD',
      sale_price,
      sale_price_starts_at: formData.sale_price_starts_at || null,
      sale_price_ends_at: formData.sale_price_ends_at || null,
      rental_price,
      booking_mode: formData.booking_mode.trim() || null,
      // Inventaire
      quantity: normalizedInventory.quantity,
      availability: resolvedAvailability,
      condition: formData.condition.trim() || 'new',
      // Identifiants
      brand: formData.brand.trim() || null,
      gtin: formData.gtin.trim() || null,
      google_product_category: formData.google_product_category.trim() || null,
      fb_product_category: formData.fb_product_category.trim() || null,
      item_group_id: formData.item_group_id.trim() || null,
      // Caractéristiques
      gender: formData.gender.trim() || null,
      color: formData.color.trim() || null,
      size: formData.size.trim() || null,
      age_group: formData.age_group.trim() || null,
      material: formData.material.trim() || null,
      pattern: formData.pattern.trim() || null,
      style: style || [],
      // Livraison
      shipping,
      shipping_weight_value,
      shipping_weight_unit: formData.shipping_weight_unit.trim() || null,
      // Offre
      offer_disclaimer: formData.offer_disclaimer.trim() || null,
      offer_disclaimer_url: formData.offer_disclaimer_url.trim() || null,
      // Tags & Attributs
      product_tags: product_tags || [],
      attributes: attributes || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (editingProduit) {
      const { error } = await supabase
        .from('produits')
        .update(payload)
        .eq('id', editingProduit.id)

      if (error) {
        console.error('Update error:', error)
        toast.error('Erreur lors de la modification: ' + error.message)
      } else {
        toast.success('Produit modifié avec succès')
        setFormOpen(false)
        fetchProduits()
      }
    } else {
      if (!account?.id) {
        toast.error('Aucun compte actif')
        setSaving(false)
        return
      }
      const { error } = await supabase
        .from('produits')
        .insert({ ...payload, account_id: account.id })

      if (error) {
        console.error('Insert error:', error)
        toast.error('Erreur lors de la création: ' + error.message)
      } else {
        toast.success('Produit créé avec succès')
        setFormOpen(false)
        fetchProduits()
      }
    }

    setSaving(false)
  }

  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    const { error } = await supabase
      .from('produits')
      .delete()
      .eq('id', deleteTarget.id)

    if (error) {
      console.error('Delete error:', error)
      toast.error('Erreur lors de la suppression')
    } else {
      toast.success('Produit supprimé')
      setDeleteTarget(null)
      fetchProduits()
    }
    setDeleting(false)
  }

  // -------------------------------------------------------------------
  // Pagination helpers
  // -------------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const canPrev = page > 0
  const canNext = page < totalPages - 1

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Produits</h1>
        </div>
        <div className="flex gap-2">
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="import products"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            Importer produits
          </GatedButton>
          <Button onClick={openCreateModal} className="gap-2">
            <Plus className="h-4 w-4" />
            Nouveau produit
          </Button>
        </div>
      </div>

      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={fetchProduits}
      />

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un produit…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-14">Image</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead className="hidden sm:table-cell">Disponibilité</TableHead>
              <TableHead className="text-right">Quantité</TableHead>
              <TableHead className="text-right">Prix</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Chargement…
                  </div>
                </TableCell>
              </TableRow>
            ) : produits.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Package className="h-8 w-8 opacity-40" />
                    {search ? 'Aucun produit trouvé' : 'Aucun produit pour le moment'}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              produits.map((p) => {
                const effectiveAvailability = (p.quantity ?? 0) > 0 ? 'in stock' : 'out of stock'
                const displayPrice = getCurrentDisplayPrice(p)

                return (
                  <TableRow key={p.id}>
                    {/* Image */}
                    <TableCell>
                      {p.image_url ? (
                        <img
                          src={p.image_url}
                          alt={p.title ?? 'Produit'}
                          className="h-10 w-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                          <Package className="h-5 w-5 text-muted-foreground opacity-50" />
                        </div>
                      )}
                    </TableCell>
                    {/* Title */}
                    <TableCell className="font-medium text-foreground">
                      {p.title || '—'}
                    </TableCell>
                    {/* Availability */}
                    <TableCell className="hidden sm:table-cell">
                      <span
                        className={
                          effectiveAvailability === 'in stock'
                            ? 'inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400'
                            : 'inline-flex items-center rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400'
                        }
                      >
                        {effectiveAvailability}
                      </span>
                    </TableCell>
                    {/* Quantity */}
                    <TableCell className="text-right tabular-nums">
                      {p.quantity != null ? p.quantity.toLocaleString('fr-FR') : '—'}
                    </TableCell>
                    {/* Current price */}
                    <TableCell className="text-right tabular-nums">
                      {displayPrice != null
                        ? Number(displayPrice).toLocaleString('fr-FR', {
                          style: 'currency',
                          currency: 'EUR',
                          minimumFractionDigits: 2,
                        })
                        : '—'}
                    </TableCell>
                    {/* Actions */}
                    <TableCell>
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
                          <DropdownMenuItem onClick={() => openEditModal(p)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            Modifier
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteTarget(p)}
                            className="text-red-400 focus:text-red-400"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} sur{' '}
              {totalCount}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!canPrev}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={!canNext}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------- */}
      {/* Create / Edit Modal                                          */}
      {/* ----------------------------------------------------------- */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {editingProduit ? 'Modifier le produit' : 'Nouveau produit'}
            </DialogTitle>
            <DialogDescription>
              {editingProduit
                ? 'Modifiez les informations du produit.'
                : 'Remplissez les informations pour créer un nouveau produit.'}
            </DialogDescription>
          </DialogHeader>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-1 py-2">
            <div className="flex flex-col gap-6">

              {/* ── Section 1 : Informations générales ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Informations générales</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-title" className="flex items-center gap-1">
                    Titre <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input
                    id="f-title"
                    placeholder="Titre du produit"
                    value={formData.title}
                    onChange={(e) => setField('title', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-description" className="flex items-center gap-1">
                    Description <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <textarea
                    id="f-description"
                    rows={3}
                    placeholder="Description du produit"
                    value={formData.description}
                    onChange={(e) => setField('description', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-vertical" className="flex items-center gap-1">
                      Vertical <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input
                      id="f-vertical"
                      placeholder="ex: fashion, electronics…"
                      value={formData.vertical}
                      onChange={(e) => setField('vertical', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-status">Statut</Label>
                    <Input
                      id="f-status"
                      placeholder="ex: active, draft…"
                      value={formData.status}
                      onChange={(e) => setField('status', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-for-sale" className="flex items-center gap-1">
                      À vendre <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <select
                      id="f-for-sale"
                      value={formData.for_sale}
                      onChange={(e) => setField('for_sale', e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-for-rent" className="flex items-center gap-1">
                      À louer <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <select
                      id="f-for-rent"
                      value={formData.for_rent}
                      onChange={(e) => setField('for_rent', e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="true">Oui</option>
                      <option value="false">Non</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-external-id" className="flex items-center gap-1">
                    ID externe <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input
                    id="f-external-id"
                    placeholder="Référence externe"
                    value={formData.external_id}
                    onChange={(e) => setField('external_id', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 2 : Médias & URL ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Médias &amp; URL</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-image-file" className="flex items-center gap-1">
                    Photo du produit {formData.for_sale === 'true' && <span className="text-red-500 font-bold">*</span>}
                  </Label>

                  {/* Aperçu ou sélecteur de fichier */}
                  {formData.image_url ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-input bg-muted/20">
                      <div className="relative h-16 w-16 rounded-md overflow-hidden border border-border bg-background shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={formData.image_url}
                          alt="Aperçu du produit"
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
                      <div className="pt-1">
                        <Input
                          id="f-image-url"
                          placeholder="Ou coller une URL d'image externe (https://…)"
                          value={formData.image_url}
                          onChange={(e) => setField('image_url', e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-additional-image-urls">
                    Images additionnelles <span className="text-xs text-muted-foreground">(URLs séparées par des virgules)</span>
                  </Label>
                  <Input
                    id="f-additional-image-urls"
                    placeholder="https://img1, https://img2"
                    value={formData.additional_image_urls}
                    onChange={(e) => setField('additional_image_urls', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-url-file" className="flex items-center gap-1">
                    URL du produit {formData.for_sale === 'true' && <span className="text-red-500 font-bold">*</span>}
                  </Label>

                  {/* Aperçu ou sélecteur de fichier pour l'URL du produit */}
                  {formData.url ? (
                    <div className="flex items-center gap-3 p-3 rounded-lg border border-input bg-muted/20">
                      <div className="relative h-16 w-16 rounded-md overflow-hidden border border-border bg-background shrink-0 flex items-center justify-center bg-muted/40">
                        {formData.url.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i) ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={formData.url}
                            alt="Aperçu URL produit"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="h-6 w-6 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground truncate">{formData.url}</span>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-primary hover:underline cursor-pointer">
                            Changer le fichier
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={handleUrlFileUpload}
                              disabled={uploadingUrl}
                            />
                          </label>
                          <span className="text-xs text-muted-foreground">•</span>
                          <button
                            type="button"
                            onClick={() => setField('url', '')}
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
                        {uploadingUrl ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span>Téléversement en cours…</span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-center">
                            <Upload className="h-6 w-6 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                              Sélectionner une image pour l'URL du produit
                            </span>
                            <span className="text-xs text-muted-foreground">PNG, JPG, WEBP jusqu'à 16 Mo</span>
                          </div>
                        )}
                        <input
                          id="f-url-file"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleUrlFileUpload}
                          disabled={uploadingUrl}
                        />
                      </label>
                      <div className="pt-1">
                        <Input
                          id="f-url"
                          placeholder="Ou saisir une URL directe (https://…)"
                          value={formData.url}
                          onChange={(e) => setField('url', e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-videos">
                    Vidéos{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-videos"
                    rows={2}
                    placeholder='[{"url":"https://…"}]'
                    value={formData.videos}
                    onChange={(e) => setField('videos', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 3 : Prix ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Prix</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-price" className="flex items-center gap-1">
                    Prix ({defaultCurrency || account?.default_currency || 'USD'}) <span className="text-red-500 font-bold">*</span>
                  </Label>
                  <Input
                    id="f-price"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={(e) => setField('price', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-price">Prix soldé</Label>
                    <Input
                      id="f-sale-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.sale_price}
                      onChange={(e) => setField('sale_price', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-rental-price">Prix de location</Label>
                    <Input
                      id="f-rental-price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={formData.rental_price}
                      onChange={(e) => setField('rental_price', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-starts">Début promo</Label>
                    <Input
                      id="f-sale-starts"
                      type="datetime-local"
                      value={formData.sale_price_starts_at}
                      onChange={(e) => setField('sale_price_starts_at', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sale-ends">Fin promo</Label>
                    <Input
                      id="f-sale-ends"
                      type="datetime-local"
                      value={formData.sale_price_ends_at}
                      onChange={(e) => setField('sale_price_ends_at', e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-booking-mode">Mode de réservation</Label>
                  <Input
                    id="f-booking-mode"
                    placeholder="ex: instant, request…"
                    value={formData.booking_mode}
                    onChange={(e) => setField('booking_mode', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 4 : Inventaire ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Inventaire</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-quantity">Quantité</Label>
                    <Input
                      id="f-quantity"
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={formData.quantity}
                      onChange={(e) => setField('quantity', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-condition" className="flex items-center gap-1">
                      Condition <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input
                      id="f-condition"
                      placeholder="new, used, refurbished…"
                      value={formData.condition}
                      onChange={(e) => setField('condition', e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 5 : Identifiants produit ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Identifiants produit (Marque requise)</SectionTitle>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-brand" className="flex items-center gap-1">
                      Marque <span className="text-red-500 font-bold">*</span>
                    </Label>
                    <Input
                      id="f-brand"
                      placeholder="Marque"
                      value={formData.brand}
                      onChange={(e) => setField('brand', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-gtin">GTIN</Label>
                    <Input
                      id="f-gtin"
                      placeholder="Code-barres EAN/UPC…"
                      value={formData.gtin}
                      onChange={(e) => setField('gtin', e.target.value)}
                    />
                  </div>
                </div>
                {/* ── Catégorie Google ── */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Catégorie Google</Label>
                    {gpcLevel1Options.length === 0 && (
                      <span className="text-xs text-amber-500">Table vide ou accès restreint par RLS</span>
                    )}
                  </div>
                  <div className="rounded-lg border border-input bg-muted/20 p-3 flex flex-col gap-2">
                    {/* Niveau 1 */}
                    <select
                      value={gpcLevel1}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGpcLevel1(val);
                        setGpcLevel2('');
                        setField('google_product_category', val);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">
                        {gpcLevel1Options.length > 0
                          ? '-- Sélectionner une catégorie principale --'
                          : '-- Aucune catégorie dans la table ou accès restreint --'}
                      </option>
                      {gpcLevel1Options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    {/* Niveau 2 */}
                    {gpcLevel1 && gpcLevel2Options.length > 0 && (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <select
                          value={gpcLevel2}
                          onChange={(e) => {
                            const val = e.target.value;
                            setGpcLevel2(val);
                            if (val) {
                              setField('google_product_category', [gpcLevel1, val].filter(Boolean).join(' > '));
                            } else {
                              setField('google_product_category', gpcLevel1);
                            }
                          }}
                          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">-- Sélectionner une sous-catégorie --</option>
                          {gpcLevel2Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* Niveau 3 */}
                    {gpcLevel2 && gpcLevel3Options.length > 0 && (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <select
                          value={formData.google_product_category}
                          onChange={(e) => {
                            const val = e.target.value;
                            const selected = gpcLevel3Options.find(opt => opt.full_path === val || opt.label === val);
                            const fullVal = selected?.full_path?.trim() || [gpcLevel1, gpcLevel2, selected?.label ?? val].filter(Boolean).join(' > ');
                            setField('google_product_category', fullVal);
                          }}
                          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">-- Sélectionner une catégorie finale --</option>
                          {gpcLevel3Options.map((opt) => {
                            const optVal = opt.full_path?.trim() || [gpcLevel1, gpcLevel2, opt.label].filter(Boolean).join(' > ');
                            return (
                              <option key={opt.full_path || opt.label} value={optVal}>{opt.label}</option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    {/* Saisie manuelle si liste vide ou souhait de précision */}
                    <div className="pt-1">
                      <Input
                        placeholder="Ou saisie libre : ex. Apparel & Accessories > Clothing"
                        value={formData.google_product_category}
                        onChange={(e) => setField('google_product_category', e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                    {/* Badge valeur finale */}
                    {formData.google_product_category && (
                      <div className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1.5">
                        <Tag className="h-3 w-3 text-primary shrink-0" />
                        <span className="text-xs font-medium text-primary truncate">{formData.google_product_category}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Catégorie Facebook ── */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label>Catégorie Facebook</Label>
                    {fbpcLevel1Options.length === 0 && (
                      <span className="text-xs text-amber-500">Table vide ou accès restreint par RLS</span>
                    )}
                  </div>
                  <div className="rounded-lg border border-input bg-muted/20 p-3 flex flex-col gap-2">
                    {/* Niveau 1 */}
                    <select
                      value={fbpcLevel1}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFbpcLevel1(val);
                        setFbpcLevel2('');
                        setField('fb_product_category', val);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">
                        {fbpcLevel1Options.length > 0
                          ? '-- Sélectionner une catégorie principale --'
                          : '-- Aucune catégorie dans la table ou accès restreint --'}
                      </option>
                      {fbpcLevel1Options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                    {/* Niveau 2 */}
                    {fbpcLevel1 && fbpcLevel2Options.length > 0 && (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <select
                          value={fbpcLevel2}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFbpcLevel2(val);
                            if (val) {
                              setField('fb_product_category', [fbpcLevel1, val].filter(Boolean).join(' > '));
                            } else {
                              setField('fb_product_category', fbpcLevel1);
                            }
                          }}
                          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">-- Sélectionner une sous-catégorie --</option>
                          {fbpcLevel2Options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* Niveau 3 */}
                    {fbpcLevel2 && fbpcLevel3Options.length > 0 && (
                      <div className="flex items-center gap-2">
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <select
                          value={formData.fb_product_category}
                          onChange={(e) => {
                            const val = e.target.value;
                            const selected = fbpcLevel3Options.find(opt => opt.full_path === val || opt.label === val);
                            const fullVal = selected?.full_path?.trim() || [fbpcLevel1, fbpcLevel2, selected?.label ?? val].filter(Boolean).join(' > ');
                            setField('fb_product_category', fullVal);
                          }}
                          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="">-- Sélectionner une catégorie finale --</option>
                          {fbpcLevel3Options.map((opt) => {
                            const optVal = opt.full_path?.trim() || [fbpcLevel1, fbpcLevel2, opt.label].filter(Boolean).join(' > ');
                            return (
                              <option key={opt.full_path || opt.label} value={optVal}>{opt.label}</option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                    {/* Saisie manuelle si liste vide ou souhait de précision */}
                    <div className="pt-1">
                      <Input
                        placeholder="Ou saisie libre : ex. Vêtements et accessoires"
                        value={formData.fb_product_category}
                        onChange={(e) => setField('fb_product_category', e.target.value)}
                        className="text-xs h-8"
                      />
                    </div>
                    {/* Badge valeur finale */}
                    {formData.fb_product_category && (
                      <div className="flex items-center gap-1.5 rounded-md bg-blue-500/10 px-2.5 py-1.5">
                        <Tag className="h-3 w-3 text-blue-500 shrink-0" />
                        <span className="text-xs font-medium text-blue-500 truncate">{formData.fb_product_category}</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-item-group">ID groupe d'articles</Label>
                  <Input
                    id="f-item-group"
                    placeholder="item_group_id"
                    value={formData.item_group_id}
                    onChange={(e) => setField('item_group_id', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 6 : Caractéristiques ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Caractéristiques</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-gender">Genre</Label>
                    <select
                      id="f-gender"
                      value={formData.gender}
                      onChange={(e) => setField('gender', e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="" hidden></option>
                      <option value="male">Homme (male)</option>
                      <option value="female">Femme (female)</option>
                      <option value="unisex">Unisexe (unisex)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-age-group">Groupe d'âge</Label>
                    <select
                      id="f-age-group"
                      value={formData.age_group}
                      onChange={(e) => setField('age_group', e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="" hidden></option>
                      <option value="newborn">Nouveau-né (newborn)</option>
                      <option value="infant">Nourrisson (infant)</option>
                      <option value="toddler">Bambin (toddler)</option>
                      <option value="kids">Enfant (kids)</option>
                      <option value="adult">Adulte (adult)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-size">Taille</Label>
                    <select
                      id="f-size"
                      value={formData.size}
                      onChange={(e) => setField('size', e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="" hidden></option>
                      <option value="XXS">XXS</option>
                      <option value="XS">XS</option>
                      <option value="S">S</option>
                      <option value="M">M</option>
                      <option value="L">L</option>
                      <option value="XL">XL</option>
                      <option value="XXL">XXL</option>
                      <option value="3XL">3XL</option>
                      <option value="TU">Taille Unique</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-color">Couleur</Label>
                    <Input
                      id="f-color"
                      placeholder="Rouge, Bleu…"
                      value={formData.color}
                      onChange={(e) => setField('color', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-material">Matière</Label>
                    <Input
                      id="f-material"
                      placeholder="Coton, Cuir…"
                      value={formData.material}
                      onChange={(e) => setField('material', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-pattern">Motif</Label>
                    <Input
                      id="f-pattern"
                      placeholder="Rayures, Uni…"
                      value={formData.pattern}
                      onChange={(e) => setField('pattern', e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-style">
                    Styles{' '}
                    <span className="text-xs text-muted-foreground">(séparés par des virgules)</span>
                  </Label>
                  <Input
                    id="f-style"
                    placeholder="casual, sport, formal"
                    value={formData.style}
                    onChange={(e) => setField('style', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 7 : Livraison ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Livraison</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-shipping">
                    Livraison{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-shipping"
                    rows={2}
                    placeholder='{"country":"FR","price":5.99}'
                    value={formData.shipping}
                    onChange={(e) => setField('shipping', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sw-value">Poids (valeur)</Label>
                    <Input
                      id="f-sw-value"
                      type="number"
                      min="0"
                      step="0.001"
                      placeholder="0.000"
                      value={formData.shipping_weight_value}
                      onChange={(e) => setField('shipping_weight_value', e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="f-sw-unit">Poids (unité)</Label>
                    <Input
                      id="f-sw-unit"
                      placeholder="kg, g, lb…"
                      value={formData.shipping_weight_unit}
                      onChange={(e) => setField('shipping_weight_unit', e.target.value)}
                    />
                  </div>
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 8 : Offre ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Offre</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-disclaimer">Mention légale de l'offre</Label>
                  <Input
                    id="f-disclaimer"
                    placeholder="Texte de mention…"
                    value={formData.offer_disclaimer}
                    onChange={(e) => setField('offer_disclaimer', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-disclaimer-url">URL de la mention</Label>
                  <Input
                    id="f-disclaimer-url"
                    placeholder="https://…"
                    value={formData.offer_disclaimer_url}
                    onChange={(e) => setField('offer_disclaimer_url', e.target.value)}
                  />
                </div>
              </section>

              <hr className="border-border" />

              {/* ── Section 9 : Tags & Attributs ── */}
              <section className="flex flex-col gap-3">
                <SectionTitle>Tags &amp; Attributs</SectionTitle>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-tags">
                    Tags produit{' '}
                    <span className="text-xs text-muted-foreground">(séparés par des virgules)</span>
                  </Label>
                  <Input
                    id="f-tags"
                    placeholder="promo, nouveauté, bestseller"
                    value={formData.product_tags}
                    onChange={(e) => setField('product_tags', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="f-attributes">
                    Attributs{' '}
                    <span className="text-xs text-muted-foreground">(JSON)</span>
                  </Label>
                  <textarea
                    id="f-attributes"
                    rows={3}
                    placeholder='{"custom_key":"value"}'
                    value={formData.attributes}
                    onChange={(e) => setField('attributes', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                </div>
              </section>

            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="shrink-0 border-t border-border pt-4">
            <Button
              variant="outline"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingProduit ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------- */}
      {/* Delete Confirmation Modal                                    */}
      {/* ----------------------------------------------------------- */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le produit</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer{' '}
              <strong className="text-foreground">{deleteTarget?.title ?? 'ce produit'}</strong> ?
              Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="gap-2"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
