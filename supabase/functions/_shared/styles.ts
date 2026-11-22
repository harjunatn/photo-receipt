/**
 * The looks a guest can have one of their photos redrawn in. The guest's page
 * only ever sends an id from this list; what the AI service is told stays here,
 * on the server, so nobody can make the booth's account draw something else.
 */
export interface AiStyle {
  id: string;
  /** What the guest reads on the button. */
  label: string;
  /** How the picture should look, as the end of "Redraw this photo as …". */
  look: string;
}

export const AI_STYLES: AiStyle[] = [
  {
    id: 'kartun',
    label: 'Kartun 3D',
    look: 'a colourful 3D animated family-film character illustration, with soft lighting, smooth rounded shapes and big expressive eyes',
  },
  {
    id: 'anime',
    label: 'Anime',
    look: 'a Japanese anime illustration with clean line art, cel shading and vivid colours',
  },
  {
    id: 'komik',
    label: 'Komik',
    look: 'a comic-book illustration with bold ink outlines, halftone dots and saturated flat colours',
  },
  {
    id: 'cat-air',
    label: 'Cat air',
    look: 'a loose watercolour painting on textured paper, with soft washes of colour and visible brush strokes',
  },
  {
    id: 'karikatur',
    label: 'Karikatur',
    look: 'a friendly hand-drawn caricature with slightly enlarged heads and playful, gently exaggerated features, in coloured pencil and marker',
  },
];

/** What the AI service is asked for one style. */
export function promptFor(style: AiStyle): string {
  return (
    `Redraw this photo as ${style.look}. ` +
    'Keep the same people: the same number of people, their poses, expressions, hairstyles, glasses, headwear and clothing colours, ' +
    'and keep each face recognisable as the same person. Keep the same framing and composition. ' +
    'Do not add any text, captions, speech bubbles, logos, watermarks or borders.'
  );
}

/** The plain photos of a session, one per shot, that a guest can pick from: p1 … p6. */
export const PLAIN_KINDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
export type PlainKind = (typeof PLAIN_KINDS)[number];

/** Failed tries a session gets before the offer closes. */
export const AI_TRIES = 3;
