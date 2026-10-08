function fmtNum(v) {
  const n = Number(v || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatLoggedItems(entries) {
  return entries
    .map((e) => {
      const grams = e.grams != null ? `${fmtNum(e.grams)}g · ` : '';
      return `• ${e.name} · ${grams}${fmtNum(e.kcal)} kcal · P${fmtNum(e.protein_g)} C${fmtNum(e.carbs_g)} F${fmtNum(e.fat_g)}`;
    })
    .join('\n');
}

export function formatDayLine(report) {
  const { eaten, targets, remaining } = report;
  const kcalWord = remaining.kcal >= 0 ? `${remaining.kcal} left` : `${-remaining.kcal} over`;
  const proteinWord = remaining.protein_g > 0 ? ` (${remaining.protein_g}g left)` : '';
  return (
    `${eaten.kcal} / ${targets.kcal} kcal (${kcalWord}) · ` +
    `P ${eaten.protein_g}/${targets.protein_g}g${proteinWord} · C ${eaten.carbs_g}/${targets.carbs_g}g · F ${eaten.fat_g}/${targets.fat_g}g`
  );
}

export function formatLogReply(entries, report) {
  const lines = [formatLoggedItems(entries), '', formatDayLine(report)];
  return lines.join('\n');
}

export function formatDayReport(report) {
  if (report.entries.length === 0) return `${report.date}: nothing logged yet.`;
  return `${report.date}\n${formatLoggedItems(report.entries)}\n\n${formatDayLine(report)}`;
}

export function formatWeekReport(week) {
  const diff = week.targetKcal - week.eatenKcal;
  const diffWord = diff >= 0 ? `${diff} under` : `${-diff} over`;
  const days = week.loggedDays.length;
  return (
    `week of ${week.weekStart} · ${days} logged day(s): ${week.eatenKcal} / ${week.targetKcal} kcal (${diffWord}) · ` +
    `protein ${week.eatenProtein} / ${week.targetProtein}g` +
    (days ? ` · avg ${week.avgKcal} kcal/day` : '')
  );
}

export function formatTargets(targets) {
  return `targets: ${targets.kcal} kcal · P${targets.protein_g} C${targets.carbs_g} F${targets.fat_g}`;
}
