import { pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // using Google sub ID which is a string
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  picture: text('picture').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).default('public').notNull(),
});

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  color: text('color').notNull(),
  name: text('name').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).default('private').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
  type: text('type', { enum: ['link', 'image', 'text', 'pdf'] }).notNull(),
  content: text('content').notNull(), // Actual URL, text snippet, or Cloudinary URL
  title: text('title'), // For link previews or PDF filenames
  description: text('description'), // For link previews
  thumbnailUrl: text('thumbnail_url'), // For link previews
  x: integer('x').default(0).notNull(), // X coordinate for freeform canvas
  y: integer('y').default(0).notNull(), // Y coordinate for freeform canvas
  zIndex: integer('z_index').default(1).notNull(), // Z-index for stacking
  rotation: integer('rotation').default(0).notNull(), // Rotation angle
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
