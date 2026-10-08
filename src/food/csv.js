const HEADER = ['id', 'date', 'time', 'name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'confidence', 'source', 'meal_type', 'photo_path'];

function escapeCsv(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function entriesToCsv(entries) {
  const rows = [HEADER.join(',')];
  for (const e of entries) {
    rows.push(HEADER.map((key) => escapeCsv(e[key])).join(','));
  }
  return rows.join('\n') + '\n';
}
