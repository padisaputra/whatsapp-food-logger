import path from 'node:path';
import { runStructured } from './claudeCli.js';

const SYSTEM_PROMPT = 'You are a nutrition estimator for a food-logging app. Respond with JSON only, matching the requested schema exactly — no prose, no markdown fences.';

const JSON_SCHEMA = {
  type: 'object',
  properties: {
    is_food: { type: 'boolean', description: 'false if the input is not a food/meal description or photo at all' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grams: { type: 'number' },
          kcal: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          fat_g: { type: 'number' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'confidence'],
      },
    },
  },
  required: ['is_food', 'items'],
};

function textPrompt(text) {
  return `Identify each distinct food item in this message, estimate its weight in grams (use any
weight the user already gave exactly; only estimate when none is given), and estimate its calories
and macros. Set confidence lower (0.3-0.6) when you had to guess portion size, higher (0.8-1.0) when
exact grams were given. If this message is not about food at all (e.g. a greeting, a question, a
command typo), set is_food to false and return an empty items array.

Message: "${text}"

Respond with JSON only, matching this schema:
${JSON.stringify(JSON_SCHEMA)}`;
}

function photoPrompt(imagePath) {
  return `Use the Read tool to look at the image at this exact path: ${imagePath}

It's either a photo of a meal, or a screenshot of a nutrition label or another calorie-tracking app.
If it's a meal photo, identify each distinct food item, estimate its weight in grams from visual cues
(plate/bowl size, utensils, hands for scale), and estimate its calories and macros; set confidence
lower (0.3-0.6) since portions are visually estimated. If it's a nutrition-label or app screenshot,
read the numbers directly instead of estimating, and set confidence higher (0.8-1.0). If the image
is not food-related at all, set is_food to false and return an empty items array.

Respond with JSON only, matching this schema:
${JSON.stringify(JSON_SCHEMA)}`;
}

function validateStructured(data) {
  if (!data || typeof data !== 'object') return 'top-level response is not an object';
  if (typeof data.is_food !== 'boolean') return 'is_food missing or not boolean';
  if (!Array.isArray(data.items)) return 'items missing or not an array';
  for (const item of data.items) {
    if (!item || typeof item.name !== 'string') return 'item missing a name';
    for (const field of ['grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g']) {
      if (typeof item[field] !== 'number' || !Number.isFinite(item[field])) return `item field ${field} is not a valid number`;
      if (item[field] < 0) return `item field ${field} is negative`;
    }
  }
  return null;
}

export function createFoodExtractor({ model, timeoutMs } = {}) {
  const resolvedModel = model || 'sonnet';

  // text: free-text description. imagePath: absolute path to a downloaded photo on disk.
  return async function extractFood({ text, imagePath }) {
    const isPhoto = Boolean(imagePath);
    const { structured } = await runStructured({
      prompt: isPhoto ? photoPrompt(imagePath) : textPrompt(text || ''),
      systemPrompt: SYSTEM_PROMPT,
      jsonSchema: JSON_SCHEMA,
      model: resolvedModel,
      tools: isPhoto ? 'Read' : '',
      restricted: isPhoto,
      cwd: isPhoto ? path.dirname(imagePath) : undefined,
      timeoutMs: timeoutMs || (isPhoto ? 90_000 : 45_000),
    });

    const err = validateStructured(structured);
    if (err) throw new Error(`claude CLI returned an invalid shape: ${err}`);
    return structured;
  };
}
