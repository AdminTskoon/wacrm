'use client';

import { useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { isUniqueViolation, dedupeByTitle, normalizeKey } from '@/lib/produits/dedupe';
import {
  parseProductCsv,
  type ParsedProductRow,
} from '@/lib/produits/parse-produits-csv';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Package,
} from 'lucide-react';

const PREVIEW_LIMIT = 5;

function truncateFilename(name: string, max = 48): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = name.slice(0, name.length - ext.length);
  const keep = max - ext.length - 1;
  return `${base.slice(0, Math.max(keep, 12))}…${ext}`;
}

function PreviewCell({
  value,
  mono,
  maxWidth = 'max-w-[9rem]',
}: {
  value: string;
  mono?: boolean;
  maxWidth?: string;
}) {
  return (
    <span
      className={cn('block truncate', maxWidth, mono && 'font-mono text-[11px]')}
      title={value}
    >
      {value}
    </span>
  );
}

/** Normalize a title for in-file / existing-row de-dupe comparisons. */


interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportModal({
  open,
  onOpenChange,
  onImported,
}: ImportModalProps) {
  const t = useTranslations('Products.importModal');
  const supabase = createClient();
  const { account } = useAuth();
  const accountId = account?.id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedProductRow[]>([]);
  const [hasAvailabilityColumn, setHasAvailabilityColumn] = useState(false);
  const [hasPriceColumn, setHasPriceColumn] = useState(false);
  const [hasQuantityColumn, setHasQuantityColumn] = useState(false);
  const [hasImageColumn, setHasImageColumn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    failed: number;
  } | null>(null);

  function reset() {
    setFile(null);
    setParsedRows([]);
    setHasAvailabilityColumn(false);
    setHasPriceColumn(false);
    setHasQuantityColumn(false);
    setHasImageColumn(false);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setResult(null);

    const text = await selected.text();
    const {
      rows,
      hasTitleColumn,
      hasBrandColumn,
      missingRequiredColumn,
      hasAvailabilityColumn: csvHasAvailability,
      hasPriceColumn: csvHasPrice,
      hasQuantityColumn: csvHasQuantity,
      hasImageColumn: csvHasImage,
    } = parseProductCsv(text);

    if (missingRequiredColumn === 'brand' || !hasBrandColumn) {
      toast.error(
        "La colonne 'marque' (ou 'brand') est obligatoire dans le fichier CSV."
      );
      reset();
      return;
    }

    if (missingRequiredColumn === 'title' || !hasTitleColumn) {
      toast.error(
        "La colonne 'titre' (ou 'title') est obligatoire dans le fichier CSV."
      );
      reset();
      return;
    }

    if (rows.length === 0) {
      toast.error(t('toastNoValidRows'));
      reset();
      return;
    }

    setParsedRows(rows);
    setHasAvailabilityColumn(csvHasAvailability);
    setHasPriceColumn(csvHasPrice);
    setHasQuantityColumn(csvHasQuantity);
    setHasImageColumn(csvHasImage);
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) throw new Error('Not authenticated');
      if (!accountId) throw new Error('Your profile is not linked to an account.');

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      let lastErrorMessage = '';

      // 1) De-dupe within the file by normalized title (keep first).
      const { unique, duplicates: inFileDupes } = dedupeByTitle(parsedRows);
      skipped += inFileDupes;

      // 2) Skip titles already in this account.
      const { data: existingRows } = await supabase
        .from('produits')
        .select('title')
        .eq('account_id', accountId);
      const existing = new Set(
        (existingRows ?? [])
          .map((r) => (r as { title: string | null }).title)
          .filter((title): title is string => !!title)
          .map(normalizeKey)
      );

      const toInsert = unique.filter((row) => {
        if (existing.has(normalizeKey(row.title))) {
          skipped++;
          return false;
        }
        return true;
      });

      // 3) Batch insert in chunks of 50. The DB backstop (if any unique
      //    constraint exists) turns a 23505 into "skipped", not "failed".
      const chunkSize = 50;

      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const rows = chunk.map((row, idx) => {
          const quantity =
            row.quantity != null && !isNaN(row.quantity)
              ? Math.trunc(row.quantity)
              : 0;
          const availability =
            row.availability?.trim() || (quantity > 0 ? 'in stock' : 'out of stock');
          const price =
            row.price != null && !isNaN(row.price) ? row.price : 0;
          const hasMedia = Boolean(row.image?.trim() || row.url?.trim());

          return {
            account_id: accountId,
            title: row.title.trim(),
            brand: row.brand.trim(),
            description: row.description?.trim() || row.title.trim(),
            price,
            currency: 'EUR',
            quantity,
            availability,
            condition: 'new',
            vertical: 'default',
            status: 'active',
            external_id: `ext-${Date.now()}-${i}-${idx}`,
            image_url: row.image?.trim() || null,
            url: row.url?.trim() || (row.image?.trim() ? row.image.trim() : null),
            for_sale: hasMedia,
            for_rent: false,
            additional_image_urls: [],
            videos: [],
            product_tags: [],
            attributes: {},
          };
        });

        const { data, error } = await supabase
          .from('produits')
          .insert(rows)
          .select('id');

        if (error) {
          console.error('Batch insert failed, retrying individually:', error);
          // Retry individually so one bad row doesn't sink the whole chunk.
          for (const row of rows) {
            const { error: singleErr } = await supabase
              .from('produits')
              .insert(row)
              .select('id')
              .single();

            if (!singleErr) {
              imported++;
            } else if (isUniqueViolation(singleErr)) {
              skipped++;
            } else {
              console.error('Single product insert error:', singleErr);
              failed++;
              if (!lastErrorMessage) {
                lastErrorMessage =
                  singleErr.message || singleErr.details || 'Erreur SQL';
              }
            }
          }
        } else {
          imported += (data ?? []).length;
        }
      }

      setResult({ imported, skipped, failed });
      if (imported > 0) {
        toast.success(t('toastImported', { count: imported }));
        onImported();
      }
      if (skipped > 0) {
        toast.info(t('toastSkipped', { count: skipped }));
      }
      if (failed > 0) {
        toast.error(
          lastErrorMessage
            ? `Échec de l'import (${failed}) : ${lastErrorMessage}`
            : t('toastFailed', { count: failed })
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('toastError');
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  const preview = parsedRows.slice(0, PREVIEW_LIMIT);
  const previewHasImage = hasImageColumn && preview.some((row) => row.image?.trim());
  const previewHasAvailability =
    hasAvailabilityColumn || preview.some((row) => row.availability?.trim());
  const previewHasPrice = hasPriceColumn || preview.some((row) => row.price != null);
  const previewHasQuantity =
    hasQuantityColumn || preview.some((row) => row.quantity != null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,720px)] flex-col gap-0 overflow-hidden border-border/80 bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <div className="shrink-0 space-y-4 border-b border-border/80 px-6 pt-6 pb-5">
          <DialogHeader className="gap-1.5">
            <DialogTitle className="text-lg text-popover-foreground">
              {t('title')}
            </DialogTitle>
            <DialogDescription
              className="leading-relaxed text-muted-foreground"
              dangerouslySetInnerHTML={{
                __html: t.markup('desc', {
                  titleCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  brandCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  availabilityCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  priceCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  quantityCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                  imageCode: (chunks) => `<code class="rounded bg-muted px-1 py-0.5 text-[11px] text-muted-foreground">${chunks}</code>`,
                }),
              }}
            />
          </DialogHeader>

          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
            }}
            className={cn(
              'group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-5 transition-all',
              file
                ? 'border-primary/35 bg-primary/[0.04]'
                : 'hover:border-primary/40 border-border/80 bg-background/40 hover:bg-background/70'
            )}
          >
            {file ? (
              <>
                <div className="bg-primary/15 ring-primary/25 flex size-10 items-center justify-center rounded-lg ring-1">
                  <FileText className="text-primary size-5" />
                </div>
                <p
                  className="max-w-full truncate px-2 text-sm font-medium text-popover-foreground"
                  title={file.name}
                >
                  {truncateFilename(file.name)}
                </p>
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t('rowsReady', { count: parsedRows.length })}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted/80 ring-1 ring-border/80 transition-colors group-hover:bg-muted">
                  <Upload className="size-5 text-muted-foreground group-hover:text-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{t('uploadDropzone')}</p>
                <p className="text-[11px] text-muted-foreground">{t('uploadHint')}</p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {preview.length > 0 && !result && (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t('preview', { count: preview.length })}
              </p>

              <div className="overflow-hidden rounded-xl border border-border ring-1 ring-border/50">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-xs">
                    <thead>
                      <tr className="border-b border-border bg-background/60">
                        {previewHasImage && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.image')}
                          </th>
                        )}
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.title')}
                        </th>
                        <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                          {t('columns.brand')}
                        </th>
                        {previewHasAvailability && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.availability')}
                          </th>
                        )}
                        {previewHasQuantity && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.quantity')}
                          </th>
                        )}
                        {previewHasPrice && (
                          <th className="px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground">
                            {t('columns.price')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {preview.map((row, i) => (
                        <tr key={i} className="bg-popover/40 transition-colors hover:bg-muted/30">
                          {previewHasImage && (
                            <td className="px-3 py-2">
                              {row.image ? (
                                <img
                                  src={row.image}
                                  alt={row.title}
                                  className="h-8 w-8 rounded-md object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                                  <Package className="h-4 w-4 text-muted-foreground opacity-50" />
                                </div>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2 text-popover-foreground">
                            <PreviewCell value={row.title} maxWidth="max-w-[10rem]" />
                          </td>
                          <td className="px-3 py-2 text-popover-foreground font-medium">
                            <PreviewCell value={row.brand} maxWidth="max-w-[8rem]" />
                          </td>
                          {previewHasAvailability && (
                            <td className="px-3 py-2 text-muted-foreground">
                              <PreviewCell value={row.availability || '—'} maxWidth="max-w-[7rem]" />
                            </td>
                          )}
                          {previewHasQuantity && (
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {row.quantity ?? '—'}
                            </td>
                          )}
                          {previewHasPrice && (
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                              {row.price != null
                                ? row.price.toLocaleString('fr-FR', {
                                  style: 'currency',
                                  currency: 'EUR',
                                  minimumFractionDigits: 2,
                                })
                                : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {parsedRows.length > PREVIEW_LIMIT && (
                <p className="text-center text-[11px] text-muted-foreground">
                  {t('moreRows', { count: parsedRows.length - PREVIEW_LIMIT })}
                </p>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-border bg-background/50 p-4">
              <p className="text-sm font-medium text-popover-foreground">{t('importComplete')}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {result.imported > 0 && (
                  <div className="text-primary flex items-center gap-1.5 text-sm">
                    <CheckCircle className="size-4 shrink-0" />
                    {t('resultImported', { count: result.imported })}
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-amber-400">
                    <AlertTriangle className="size-4 shrink-0" />
                    {t('resultSkipped', { count: result.skipped })}
                  </div>
                )}
                {result.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-sm text-red-400">
                    <XCircle className="size-4 shrink-0" />
                    {t('resultFailed', { count: result.failed })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-0 shrink-0 gap-2 border-t border-border/80 bg-background/50 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {result ? t('close') : t('cancel')}
          </Button>
          {!result && (
            <Button
              type="button"
              disabled={parsedRows.length === 0 || importing}
              onClick={handleImport}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {importing && <Loader2 className="size-4 animate-spin" />}
              {t('importBtn', { count: parsedRows.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}