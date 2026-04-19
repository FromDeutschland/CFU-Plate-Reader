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

function sumPixelArea(colonies: Colony[]): number {
  let t = 0;
  for (const c of colonies) if (c.status !== 'rejected') t += c.area;
  return t;
}

export function buildResults(entries: RegionEntry[]): AnalysisResult[] {
  return entries.map(({ region, dilutionFactor, volumeMl, colonies }) => {
    const { confirmed, auto, total } = countColonies(colonies);
    const cfuPerMl = calculateCFU(total, dilutionFactor, volumeMl);
    return {
      regionId:      region.id,
      label:         region.label,
      selectionKind: region.kind,
      dilutionFactor,
      volumeMl,
      confirmedCount: confirmed,
      autoCount:      auto,
      totalCount:     total,
      totalPixelArea: sumPixelArea(colonies),
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

  rows.push('OmniCount CFU Analysis Export — generated ' + new Date().toISOString());
  rows.push('');
  rows.push('Summary');
  rows.push('Region,Selection_Type,Pixel_Area,Raw_Count,Dilution_Factor,Volume_mL,CFU_per_mL,SOP_Status');

  for (const r of results) {
    const sopLabel = r.sopStatus === 'ok' ? 'OK'
      : r.sopStatus === 'tftc' ? 'TFTC (<25)'
      : r.sopStatus === 'tmtc' ? 'TMTC (>250)'
      : 'Pending';
    rows.push([
      `"${r.label}"`,
      r.selectionKind,
      r.totalPixelArea,
      r.totalCount,
      r.dilutionFactor,
      r.volumeMl,
      r.cfuPerMl.toExponential(2),
      sopLabel,
    ].join(','));
  }

  rows.push('');
  rows.push('Colony Detail');
  rows.push('Region,Colony_ID,Center_X,Center_Y,Radius_px,Area_px2,Circularity,Edge_Sharpness,LBP_Variance,Confidence,Status');

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
        c.edgeSharpness.toFixed(3),
        c.lbpVariance.toFixed(3),
        c.confidence.toFixed(2),
        c.status,
      ].join(','));
    }
  }

  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `omnicount-results-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Renders a printable HTML report with the annotated plate image. */
export function exportToPdf(
  results: AnalysisResult[],
  entries: RegionEntry[],
  plateImage: HTMLImageElement | null
): void {
  // Rasterise the plate with overlay into a data URL
  let imageDataUrl = '';
  if (plateImage) {
    const maxW = 1200;
    const scale = Math.min(1, maxW / plateImage.naturalWidth);
    const cw = Math.round(plateImage.naturalWidth * scale);
    const ch = Math.round(plateImage.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(plateImage, 0, 0, cw, ch);

    // Overlay regions + colonies
    entries.forEach((entry, idx) => {
      const color = ['#60a5fa','#a78bfa','#34d399','#f59e0b','#f472b6','#38bdf8'][idx % 6];
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (entry.region.kind === 'lasso' && entry.region.polygon) {
        ctx.beginPath();
        ctx.moveTo(entry.region.polygon[0].x * scale, entry.region.polygon[0].y * scale);
        for (let i = 1; i < entry.region.polygon.length; i++) {
          ctx.lineTo(entry.region.polygon[i].x * scale, entry.region.polygon[i].y * scale);
        }
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(entry.region.cx * scale, entry.region.cy * scale, entry.region.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(entry.region.label, entry.region.cx * scale, (entry.region.cy - entry.region.radius) * scale - 6);
      ctx.restore();
    });

    let colNum = 0;
    for (const entry of entries) {
      for (const c of entry.colonies) {
        if (c.status === 'rejected') continue;
        colNum++;
        ctx.beginPath();
        ctx.arc(c.cx * scale, c.cy * scale, Math.max(c.radius, 3) * scale, 0, Math.PI * 2);
        ctx.strokeStyle = c.status === 'confirmed' ? '#22c55e'
          : c.confidence >= 0.7 ? '#22c55e'
          : c.confidence >= 0.4 ? '#f97316'
          : '#ef4444';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(34,197,94,0.9)';
        ctx.font = '9px sans-serif';
        ctx.fillText(String(colNum), c.cx * scale, c.cy * scale - Math.max(c.radius, 3) * scale - 2);
      }
    }

    imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
  }

  const now = new Date();

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>OmniCount CFU Report — ${now.toISOString().slice(0, 10)}</title>
<style>
  body { font: 13px system-ui, sans-serif; color: #222; max-width: 960px; margin: 2em auto; padding: 0 1em; }
  h1 { margin: 0 0 .2em; font-size: 24px; }
  .meta { color: #666; font-size: 11px; margin-bottom: 1.5em; }
  table { width: 100%; border-collapse: collapse; margin: .5em 0 1.5em; font-size: 11.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
  th { background: #f4f4f7; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; font-size: 10px; }
  .sop-ok { color: #0a7c3a; font-weight: 600; }
  .sop-tftc { color: #b86e00; }
  .sop-tmtc { color: #b21e1e; }
  img.plate { max-width: 100%; border: 1px solid #ddd; border-radius: 6px; display: block; margin: 1em 0 2em; }
  @media print { body { margin: .5in; } }
</style></head>
<body>
  <h1>OmniCount — CFU Analysis Report</h1>
  <div class="meta">Generated ${now.toLocaleString()}</div>
  ${imageDataUrl ? `<img class="plate" src="${imageDataUrl}" alt="Annotated plate" />` : ''}
  <h2>Per-region summary</h2>
  <table>
    <thead><tr>
      <th>Region</th><th>Selection_Type</th><th>Pixel_Area</th><th>Raw_Count</th>
      <th>Dilution_Factor</th><th>Volume_mL</th><th>CFU/mL</th><th>SOP_Status</th>
    </tr></thead>
    <tbody>
    ${results.map(r => {
      const cls = r.sopStatus === 'ok' ? 'sop-ok'
        : r.sopStatus === 'tftc' ? 'sop-tftc'
        : r.sopStatus === 'tmtc' ? 'sop-tmtc' : '';
      const label = r.sopStatus === 'ok' ? 'OK'
        : r.sopStatus === 'tftc' ? `TFTC (<${SOP_MIN})`
        : r.sopStatus === 'tmtc' ? `TMTC (>${SOP_MAX})`
        : 'Pending';
      return `<tr>
        <td>${r.label}</td>
        <td>${r.selectionKind}</td>
        <td>${r.totalPixelArea.toLocaleString()}</td>
        <td><strong>${r.totalCount}</strong></td>
        <td>1:${r.dilutionFactor.toLocaleString()}</td>
        <td>${r.volumeMl}</td>
        <td>${r.cfuPerMl === 0 ? '—' : r.cfuPerMl.toExponential(2)}</td>
        <td class="${cls}">${label}</td>
      </tr>`;
    }).join('')}
    </tbody>
  </table>
  <p style="color:#666;font-size:11px;">CFU/mL = (Colony_Count × Dilution_Factor) / Volume_Plated. Acceptable SOP range: ${SOP_MIN}–${SOP_MAX} colonies.</p>
  <script>window.onload = () => setTimeout(() => window.print(), 250);</script>
</body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to export a printable report.'); return; }
  w.document.write(html);
  w.document.close();
}
