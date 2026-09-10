/**
 * CSV parsing for the products import modal. Shared + unit-tested so
 * column handling stays aligned with title/availability/price/quantity/image.
 */

export interface ParsedProductRow {
  title: string;
  brand: string;
  availability?: string;
  price?: number;
  quantity?: number;
  image?: string;
  url?: string;
  description?: string;
}

export interface ParseProductCsvResult {
  rows: ParsedProductRow[];
  /** True when the CSV header includes a title/titre column. */
  hasTitleColumn: boolean;
  /** True when the CSV header includes a brand/marque column. */
  hasBrandColumn: boolean;
  /** True when the CSV header includes an availability column. */
  hasAvailabilityColumn: boolean;
  /** True when the CSV header includes a price column. */
  hasPriceColumn: boolean;
  /** True when the CSV header includes a quantity column. */
  hasQuantityColumn: boolean;
  /** True when the CSV header includes an image column. */
  hasImageColumn: boolean;
  /** Missing required column if any */
  missingRequiredColumn?: 'title' | 'brand';
}

/** Parse a numeric cell, tolerating comma decimals and stray spaces. */
function parseNumericCell(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.replace(/["']/g, '').trim().replace(',', '.');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function findHeaderIndex(headers: string[], candidates: string[]): number {
  return headers.findIndex((h) => candidates.includes(h.trim().toLowerCase().replace(/["']/g, '')));
}

export function parseProductCsv(text: string): ParseProductCsvResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return {
      rows: [],
      hasTitleColumn: false,
      hasBrandColumn: false,
      hasAvailabilityColumn: false,
      hasPriceColumn: false,
      hasQuantityColumn: false,
      hasImageColumn: false,
    };
  }

  // Detect comma or semicolon separator
  const headerLine = lines[0];
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const delimiter = semiCount > commaCount ? ';' : ',';

  const headers = parseCsvLine(headerLine, delimiter).map((h) =>
    h.trim().toLowerCase().replace(/["']/g, '')
  );

  const titleIdx = findHeaderIndex(headers, ['title', 'titre', 'nom', 'name']);
  const brandIdx = findHeaderIndex(headers, ['brand', 'marque']);
  const availabilityIdx = findHeaderIndex(headers, ['availability', 'disponibilite', 'disponibilité', 'etat']);
  const priceIdx = findHeaderIndex(headers, ['price', 'prix']);
  const quantityIdx = findHeaderIndex(headers, ['quantity', 'quantite', 'quantité', 'stock']);
  const imageIdx = findHeaderIndex(headers, ['image', 'image_url', 'photo', 'url_image', 'image url']);
  const urlIdx = findHeaderIndex(headers, ['url', 'link', 'lien']);
  const descIdx = findHeaderIndex(headers, ['description', 'desc']);

  const hasTitleColumn = titleIdx >= 0;
  const hasBrandColumn = brandIdx >= 0;

  if (!hasTitleColumn) {
    return {
      rows: [],
      hasTitleColumn: false,
      hasBrandColumn,
      hasAvailabilityColumn: availabilityIdx >= 0,
      hasPriceColumn: priceIdx >= 0,
      hasQuantityColumn: quantityIdx >= 0,
      hasImageColumn: imageIdx >= 0,
      missingRequiredColumn: 'title',
    };
  }

  if (!hasBrandColumn) {
    return {
      rows: [],
      hasTitleColumn: true,
      hasBrandColumn: false,
      hasAvailabilityColumn: availabilityIdx >= 0,
      hasPriceColumn: priceIdx >= 0,
      hasQuantityColumn: quantityIdx >= 0,
      hasImageColumn: imageIdx >= 0,
      missingRequiredColumn: 'brand',
    };
  }

  const rows: ParsedProductRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCsvLine(line, delimiter);
    const title = values[titleIdx]?.replace(/["']/g, '').trim();
    const brand = values[brandIdx]?.replace(/["']/g, '').trim();
    if (!title || !brand) continue;

    rows.push({
      title,
      brand,
      availability:
        availabilityIdx >= 0
          ? values[availabilityIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      price: priceIdx >= 0 ? parseNumericCell(values[priceIdx]) : undefined,
      quantity:
        quantityIdx >= 0 ? parseNumericCell(values[quantityIdx]) : undefined,
      image:
        imageIdx >= 0
          ? values[imageIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      url:
        urlIdx >= 0
          ? values[urlIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
      description:
        descIdx >= 0
          ? values[descIdx]?.replace(/["']/g, '').trim() || undefined
          : undefined,
    });
  }

  return {
    rows,
    hasTitleColumn: true,
    hasBrandColumn: true,
    hasAvailabilityColumn: availabilityIdx >= 0,
    hasPriceColumn: priceIdx >= 0,
    hasQuantityColumn: quantityIdx >= 0,
    hasImageColumn: imageIdx >= 0,
  };
}

/** Simple CSV line parse (handles quoted fields and escaped quotes). */
function parseCsvLine(line: string, delimiter: string = ','): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}