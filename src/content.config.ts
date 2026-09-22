import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const entries = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/entries' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    groan: z.number().int().min(0).max(5).optional(),
    via: z.string().optional(),
    images: z.array(z.string()).default([]),
    caption: z.string().optional(),
    slack_ts: z.string().optional(),
  }),
});

export const collections = { entries };
