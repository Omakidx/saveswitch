import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(), // using Google sub ID which is a string
  email: text('email').notNull().unique(),
  username: text('username').unique(), // null for legacy users until they update
  name: text('name').notNull(),
  picture: text('picture').notNull(),
  visibility: text('visibility', { enum: ['public', 'private'] }).default('public').notNull(),
}, (table) => [
  check('users_visibility_check', sql`${table.visibility} in ('public', 'private')`),
]);

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
  resourceCount: integer('xoomshare_resource_count').default(0).notNull(),
  resourceBytes: integer('xoomshare_resource_bytes').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('pages_path_code_unique')
    .on(table.pathCode)
    .where(sql`${table.pathCode} is not null`),
  index('pages_session_id_idx').on(table.sessionId),
  check('pages_visibility_check', sql`${table.visibility} in ('public', 'private')`),
  check('pages_xoomshare_resource_count_nonnegative', sql`${table.resourceCount} >= 0`),
  check('pages_xoomshare_resource_bytes_nonnegative', sql`${table.resourceBytes} >= 0`),
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
  sessionId: text('session_id'), // Opaque Xoomshare room-participant id (or null for legacy resources)
  sizeBytes: integer('size_bytes').default(0).notNull(),
  providerPublicId: text('provider_public_id'),
  providerResourceType: text('provider_resource_type', { enum: ['image', 'raw'] }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('resources_page_id_idx').on(table.pageId),
  check('resources_type_check', sql`${table.type} in ('link', 'image', 'text', 'pdf', 'file')`),
  check('resources_size_bytes_nonnegative', sql`${table.sizeBytes} >= 0`),
  check(
    'resources_provider_pair_check',
    sql`(${table.providerPublicId} is null and ${table.providerResourceType} is null)
      or (${table.providerPublicId} is not null and ${table.providerResourceType} in ('image', 'raw'))`,
  ),
]);

/** Durable cleanup work for Cloudinary assets after the referring row is gone. */
export const assetDeletionQueue = pgTable('asset_deletion_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  providerPublicId: text('provider_public_id').notNull(),
  providerResourceType: text('provider_resource_type', { enum: ['image', 'raw'] }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('asset_deletion_queue_provider_public_id_unique').on(table.providerPublicId),
  index('asset_deletion_queue_created_at_idx').on(table.createdAt),
  check('asset_deletion_queue_provider_resource_type_check', sql`${table.providerResourceType} in ('image', 'raw')`),
  check('asset_deletion_queue_attempts_nonnegative', sql`${table.attempts} >= 0`),
]);
