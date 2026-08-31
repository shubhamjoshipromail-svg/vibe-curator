export interface StylePromptCollection {
  mood: string;
  stylePrompt?: string;
}

export interface StylePromptValues {
  subject: string;
  setting: string;
  time: string;
  weather: string;
  mood: string;
}

/** Build a complete reusable style recipe without leaking missing metadata. */
export function buildStylePrompt(collection: StylePromptCollection, values: StylePromptValues): string {
  const style = collection.stylePrompt ? ` Fixed visual style: ${collection.stylePrompt}` : '';
  return `Create ${values.subject || 'an original scene'}${values.setting ? ` in ${values.setting}` : ''}. Time of day: ${values.time || 'artist choice'}. Weather/atmosphere: ${values.weather || 'artist choice'}. Desired mood: ${values.mood || collection.mood}.${style} Full-screen 16:9 background; no text, logo, watermark or UI.`;
}
