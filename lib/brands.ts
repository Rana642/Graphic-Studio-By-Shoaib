import "server-only";
import { db } from "./supabase/db";

export type Brand = {
  id: string;
  name: string;
  logo_url: string | null;
  primary_hex: string;
  secondary_hex: string | null;
  accent_hex: string | null;
  font_family: string | null;
  voice_notes: string | null;
  about: string | null;
  services: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  facebook_handle: string | null;
  linkedin_handle: string | null;
  tiktok_handle: string | null;
  created_at: string;
};

export type BrandInput = {
  name: string;
  logo_url?: string | null;
  primary_hex: string;
  secondary_hex?: string | null;
  accent_hex?: string | null;
  font_family?: string | null;
  voice_notes?: string | null;
  about?: string | null;
  services?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  website_url?: string | null;
  instagram_handle?: string | null;
  facebook_handle?: string | null;
  linkedin_handle?: string | null;
  tiktok_handle?: string | null;
};

export async function listBrands(): Promise<Brand[]> {
  const { data, error } = await db.from("brands").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getBrand(id: string): Promise<Brand | null> {
  const { data, error } = await db.from("brands").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createBrand(input: BrandInput): Promise<Brand> {
  const { data, error } = await db.from("brands").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateBrand(id: string, input: BrandInput): Promise<Brand> {
  const { data, error } = await db
    .from("brands")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBrand(id: string): Promise<void> {
  const { error } = await db.from("brands").delete().eq("id", id);
  if (error) throw error;
}
