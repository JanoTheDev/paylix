import { request } from "./request";
import type {
  PaylixConfig,
  CreateProductParams,
  UpdateProductParams,
  Product,
} from "./types";

export async function createProduct(
  config: PaylixConfig,
  params: CreateProductParams,
): Promise<Product> {
  return request<Product>(config, "POST", "/api/products", { body: params });
}

export async function updateProduct(
  config: PaylixConfig,
  id: string,
  params: UpdateProductParams,
): Promise<Product> {
  return request<Product>(
    config,
    "PATCH",
    `/api/products/${encodeURIComponent(id)}`,
    { body: params },
  );
}

export async function listProducts(config: PaylixConfig): Promise<Product[]> {
  return request<Product[]>(config, "GET", "/api/products");
}
