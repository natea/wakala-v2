import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
import { ServiceError } from './base-service';

interface ValidationSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export const validateRequest = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(
          new ServiceError(400, 'Validation error', 'VALIDATION_ERROR', {
            errors: error.errors,
          }),
        );
      } else {
        next(error);
      }
    }
  };
};