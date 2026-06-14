// Zod Schemas for Validation

import { z } from 'zod';

// Base schema
export const BaseSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Create schema (for POST requests)
export const CreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().optional(),
});

// Update schema (for PUT requests)
export const UpdateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  description: z.string().optional(),
});

// Response schema
export const ResponseSchema = BaseSchema.merge(CreateSchema);

// Query parameters schema
export const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Error response schema
export const ErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

// Types
export type CreateInput = z.infer<typeof CreateSchema>;
export type UpdateInput = z.infer<typeof UpdateSchema>;
export type QueryInput = z.infer<typeof QuerySchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorSchema>;

// Validation middleware example
export const validateCreate = (data: unknown) => {
  return CreateSchema.parse(data);
};

export const validateUpdate = (data: unknown) => {
  return UpdateSchema.parse(data);
};

export const validateQuery = (data: unknown) => {
  return QuerySchema.parse(data);
};