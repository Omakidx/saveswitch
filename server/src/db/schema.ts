import { sql } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // using Google sub ID which is a string
  email: text('email').notNull().unique(),
  username: text('username').unique(), // null for legacy users until they update
  name: text('name').notNull(),
  picture: text('picture').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).default('public').notNull(),
});

export const pages = pgTable('pages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  color: text('color').notNull(),
  name: text('name').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).default('private').notNull(),
  pathCode: text('path_code'),
  sessionId: text('session_id'),
  expiresAt: timestamp('expires_at'),
  allowGuestResources: boolean('allow_guest_resources').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('pages_path_code_unique')
    .on(table.pathCode)
    .where(sql`${table.pathCode} is not null`),
]);

export const resources = pgTable('resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  pageId: uuid('page_id').references(() => pages.id, { onDelete: 'cascade' }).notNull(),
  type: text('type', { enum: ['link', 'image', 'text', 'pdf', 'file'] }).notNull(),
  content: text('content').notNull(), // Actual URL, text snippet, or Cloudinary URL
  title: text('title'), // For link previews or PDF filenames
  description: text('description'), // For link previews
  thumbnailUrl: text('thumbnail_url'), // For link previews
  x: integer('x').default(0).notNull(), // X coordinate for freeform canvas
  y: integer('y').default(0).notNull(), // Y coordinate for freeform canvas
  zIndex: integer('z_index').default(1).notNull(), // Z-index for stacking
  rotation: integer('rotation').default(0).notNull(), // Rotation angle
  sessionId: text('session_id'), // Track which session/device created this resource
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
