// Pure helper functions for the setup wizard (scripts/setup.js) — kept free of
// readline/fs/child_process so they're cheap to unit test.

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const GOAL_ADJUSTMENT_KCAL = {
  cut: -500,
  maintain: 0,
  bulk: 300,
};

// Mifflin-St Jeor BMR -> TDEE -> goal-adjusted calories, with protein pinned to
// 2 g/kg bodyweight and fat to 25% of calories; carbs take the remainder.
export function computeTargetsFromProfile({ weightKg, heightCm, age, sex, activity, goal }) {
  const bmr = sex === 'female'
    ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
    : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;

  const multiplier = ACTIVITY_MULTIPLIERS[activity] ?? ACTIVITY_MULTIPLIERS.moderate;
  const tdee = bmr * multiplier;
  const kcal = Math.round(tdee + (GOAL_ADJUSTMENT_KCAL[goal] ?? 0));

  const protein_g = Math.round(weightKg * 2);
  const fat_g = Math.round((kcal * 0.25) / 9);
  const remainingKcal = Math.max(0, kcal - protein_g * 4 - fat_g * 9);
  const carbs_g = Math.round(remainingKcal / 4);

  return { kcal, protein_g, carbs_g, fat_g };
}

export function parseAllowedNumbers(input) {
  return [...new Set(
    String(input || '')
      .split(',')
      .map((n) => n.replace(/\D/g, ''))
      .filter(Boolean),
  )];
}

// Replaces `KEY=...` lines in an .env.example-shaped template with provided
// values, leaving comments and any key not in `values` untouched.
export function renderEnv(templateText, values) {
  return templateText
    .split('\n')
    .map((line) => {
      const m = line.match(/^([A-Z_]+)=/);
      if (m && Object.prototype.hasOwnProperty.call(values, m[1])) {
        return `${m[1]}=${values[m[1]]}`;
      }
      return line;
    })
    .join('\n');
}

export function isAuthError(message) {
  return /401|invalid authentication|not logged in|please run \/login/i.test(message || '');
}
