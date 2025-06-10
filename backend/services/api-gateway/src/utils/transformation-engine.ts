import { Request } from 'express';

export class TransformationEngine {
  private requestTransformations: Map<string, any>;
  private responseTransformations: Map<string, any>;

  constructor() {
    this.requestTransformations = new Map();
    this.responseTransformations = new Map();
    this.initializeTransformations();
  }

  private initializeTransformations(): void {
    // Request transformations
    this.requestTransformations.set('POST:/api/v1/orders', {
      transform: (body: any) => ({
        customerId: body.customer_id || body.customerId,
        items: (body.order_items || body.items || []).map((item: any) => ({
          sku: item.sku,
          quantity: item.qty || item.quantity
        }))
      })
    });

    // Response transformations
    this.responseTransformations.set('v1', {
      transform: (data: any) => {
        const transformed: any = { ...data };
        
        // Remove internal fields
        delete transformed.internalId;
        
        // Transform field names
        if (transformed.orderId) {
          transformed.order_id = transformed.orderId;
          delete transformed.orderId;
        }
        
        if (transformed.createdAt) {
          transformed.created_at = transformed.createdAt;
          delete transformed.createdAt;
        }

        transformed.version = '1.0';
        
        return transformed;
      }
    });

    this.responseTransformations.set('v2', {
      transform: (data: any) => {
        const transformed: any = { ...data };
        
        transformed.version = '2.0';
        transformed.additionalField = 'v2-specific-data';
        
        return transformed;
      }
    });
  }

  public transformRequest(req: Request): any {
    const key = `${req.method}:${req.path}`;
    const transformation = this.requestTransformations.get(key);
    
    if (transformation && req.body) {
      return {
        ...req,
        body: transformation.transform(req.body)
      };
    }

    return req;
  }

  public transformResponse(data: any, version: string): any {
    const transformation = this.responseTransformations.get(version);
    
    if (transformation) {
      return transformation.transform(data);
    }

    return data;
  }

  public addRequestTransformation(pattern: string, transformer: (data: any) => any): void {
    this.requestTransformations.set(pattern, { transform: transformer });
  }

  public addResponseTransformation(version: string, transformer: (data: any) => any): void {
    this.responseTransformations.set(version, { transform: transformer });
  }
}