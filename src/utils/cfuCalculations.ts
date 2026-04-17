import type { Colony, AnalysisResult, RegionEntry, SopStatus } from '../types';

/** Acceptable CFU count range per standard microbiology SOP (25–250 colonies) */
export const SOP_MIN = 25;
export const SOP_MAX = 250;

export function countColonies(colonies: Colony[]): { confirmed: number; auto: number; total: number } {
  const confirmed = colonies.filter(c => c.status === 'confirmed').length;
  const auto      = colonies.filter(c => c.status === 'auto').length;
  return { confirmed, auto, total: confirmed + auto };
}

export function sopCheck(count: number): SopStatus {
  if (count === 0) return 'pending';
  if (count < SOP_MIN) return 'tftc';
  if (count > SOP_MAX) return 'tmtc';
  return 'ok';
}

export function calculateCFU(count: number, dilutionFactor: number, volumeMl: number): number {
  if (volumeMl <= 0 || dilutionFactor <= 0) return 0;
  return count * dilutionFactor / volumeMl;
}

export function buildResults(entries: RegionEntry[]): AnalysisResult[] {
  return entries.map(({ region, dilutionFactor, volumeMl, colonies }) => {
    const { confirmed, auto, total } = countColonies(colonies);
    const cfuPerMl = calculateCFU(total, dilutionFactor, volumeMl);
    return {
      regionId:      region.id,
      label:         region.label,
      dilutionFactor,
      volumeMl,
      confirmedCount: confirmed,
      autoCount:      auto,
      totalCount:     total,
      cfuPerMl,
      sopStatus:      sopCheck(total),
    };
  });
}

export function formatCFU(cfu: number): string {
  if (cfu === 0) return '—';
  const exp      = Math.floor(Math.log10(Math.abs(cfu)));
  const mantissa = cfu / 10 ** exp;
  if (exp === 0 || exp === 1) return cfu.toFixed(0);
  return `${mantissa.toFixed(2)} × 10^${exp}`;
}

export function exportToCsv(results: AnalysisResult[], entries: RegionEntry[]): void {
  const rows: string[] = [];

  rows.push('CFU Analysis Export — generated ' + new Date().toISOString());
  rows.push('');
  rows.push('Summary');
  rows.push('Region,Colony Count,Dilution Factor,Volume (mL),CFU/mL,SOP Status');

  for (const r of results) {
    const sopLabel = r.sopStatus === 'ok' ? 'OK'
      : r.sopStatus === 'tftc' ? 'TFTC (<25)'
      : r.sopStatus === 'tmtc' ? 'TMTC (>250)'
      : 'Pending';
    rows.push([
      `"${r.label}"`,
      r.totalCount,
      r.dilutionFactor,
      r.volumeMl,
      r.cfuPerMl.toExponential(2),
      sopLabel,
    ].join(','));
  }

  rows.push('');
  rows.push('Colony Detail');
  rows.push('Region,Colony ID,Center X,Center Y,Radius (px),Area (px²),Circularity,Confidence,Status');

  for (const entry of entries) {
    for (const c of entry.colonies) {
      if (c.status === 'rejected') continue;
      rows.push([
        `"${entry.region.label}"`,
        c.id,
        c.cx.toFixed(1),
        c.cy.toFixed(1),
        c.radius.toFixed(1),
        c.area,
        c.circularity.toFixed(3),
        c.confidence.toFixed(2),
        c.status,
      ].join(','));
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cfu-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
