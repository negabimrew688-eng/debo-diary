import { z } from 'zod';

const num = (min, max) => z.coerce.number().min(min).max(max);
const optNum = (min, max) => z.coerce.number().min(min).max(max).optional();
const text = (max = 200) => z.string().trim().min(1).max(max);
const optText = (max = 200) => z.string().trim().max(max).optional();
export const uuid = z.string().uuid();
const imageUrl = z.string().regex(/^\/uploads\/[\w-]+\.(jpg|png|webp)$/, 'Use the URL returned by the upload endpoint');
const phone = z.string().regex(/^\+?[0-9]{9,15}$/, 'Phone must be 9-15 digits, optionally starting with +');

export const idParam = z.object({ id: uuid });

export const profileSchemas = {
  farmer: z.object({ farm_name: optText(), location_text: optText(), latitude: optNum(-90, 90), longitude: optNum(-180, 180) }).strict(),
  buyer: z.object({ buyer_type: z.enum(['individual', 'processor', 'collection_centre']).optional(), org_name: optText(), address: optText(), business_type: optText(80), payment_preference: z.enum(['telebirr']).optional() }).strict(),
  feed_supplier: z.object({ business_name: optText(), address: optText() }).strict(),
  transporter: z.object({
    company_name: optText(), vehicle_type: optText(80), plate_number: optText(30),
    capacity_litres: z.coerce.number().int().min(1).max(100000).optional(),
    has_cold_storage: z.boolean().optional(), service_area: optText(), available: z.boolean().optional(),
  }).strict(),
};

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(100).regex(/[A-Za-z]/, 'Password needs a letter').regex(/[0-9]/, 'Password needs a digit'),
  full_name: text(120),
  phone: phone.optional(),
  role: z.enum(['farmer', 'buyer', 'feed_supplier', 'transporter']),
  region: optText(80),
  woreda: optText(80),
  profile: z.record(z.any()).optional(),
});

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(100) });

export const updateMeSchema = z.object({
  full_name: text(120).optional(), phone: phone.optional(), region: optText(80), woreda: optText(80),
  avatar_url: imageUrl.optional(), notification_prefs: z.object({ in_app: z.boolean() }).strict().optional(),
  profile: z.record(z.any()).optional(),
});

export const cowSchema = z.object({
  tag: text(40), breed: optText(60), age_months: z.coerce.number().int().min(0).max(360).optional(),
  lactating: z.boolean().optional(), daily_yield_litres: optNum(0, 80),
});
export const cowUpdateSchema = cowSchema.partial();

export const batchSchema = z.object({
  volume_litres: num(1, 100000),
  produced_at: z.coerce.date().refine((d) => d.getTime() <= Date.now() + 5 * 60e3, 'Production time cannot be in the future')
    .refine((d) => d.getTime() >= Date.now() - 48 * 3600e3, 'Milk older than 48 hours cannot be listed'),
  collection_location: text(200),
  latitude: optNum(-90, 90), longitude: optNum(-180, 180),
});

export const testSchema = z.object({
  lactometer_reading: num(10, 45),
  temperature_c: num(0, 45),
  fat_percent: optNum(0, 12),
  conductivity_ms: optNum(0, 12),
  image_brightness: optNum(0, 255),
  image_url: imageUrl.optional(),
  notes: optText(500),
});

export const listBatchSchema = z.object({ asking_price: optNum(0.01, 100000) });

export const marketQuerySchema = z.object({
  location: optText(100), min_volume: optNum(0, 100000), max_price: optNum(0, 100000),
  grade: z.enum(['A', 'B']).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'reputation', 'quality']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const compareQuerySchema = z.object({ ids: z.string().transform((s) => s.split(',').filter(Boolean)).pipe(z.array(uuid).min(2).max(4)) });

export const orderSchema = z.object({ batch_id: uuid, volume_litres: num(1, 100000), delivery_address: text(300) });
export const deliveryRequestSchema = z.object({ transporter_id: uuid.optional(), pickup_note: optText(300) });
export const confirmSchema = testSchema.omit({ image_url: true }).extend({ accept_anyway: z.boolean().optional() });
export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(1000), evidence_url: imageUrl.optional() });
export const resolveSchema = z.object({ decision: z.enum(['refund_buyer', 'release_to_farmer']), note: z.string().trim().min(3).max(1000) });
export const sandboxPaySchema = z.object({ outcome: z.enum(['success', 'fail']).default('success') });

export const feedProductSchema = z.object({
  name: text(120), description: optText(500),
  category: z.enum(['concentrate', 'forage', 'mineral', 'by_product', 'other']).optional(),
  price_per_kg: num(0.01, 100000), stock_kg: num(0, 10000000), protein_percent: optNum(0, 60),
  active: z.boolean().optional(),
});
export const feedProductUpdateSchema = feedProductSchema.partial();
export const feedOrderSchema = z.object({ product_id: uuid, quantity_kg: num(1, 100000) });
export const feedOrderStatusSchema = z.object({ status: z.enum(['accepted', 'delivered', 'cancelled']) });
export const feedQuerySchema = z.object({ q: optText(100), category: z.enum(['concentrate', 'forage', 'mineral', 'by_product', 'other']).optional() });

export const byproductSchema = z.object({
  kind: z.enum(['compost', 'cow_manure', 'whey', 'other']), description: optText(500),
  quantity_kg: num(1, 10000000), price_per_kg: num(0, 100000),
});
export const byproductStatusSchema = z.object({ status: z.enum(['available', 'sold', 'withdrawn']) });

export const deliveryRespondSchema = z.object({ action: z.enum(['accept', 'reject']) });
export const deliveryStatusSchema = z.object({ status: z.enum(['collected', 'in_transit', 'delivered']) });

export const adminUserUpdateSchema = z.object({ is_active: z.boolean().optional(), fayda_verified: z.boolean().optional() });
export const adminUsersQuery = z.object({ role: z.enum(['farmer', 'buyer', 'feed_supplier', 'transporter', 'admin']).optional(), q: optText(100) });
export const settingsUpdateSchema = z.object({
  base_price_per_litre: optNum(1, 10000),
  grade_a_max_water: optNum(0, 50), grade_b_max_water: optNum(0, 90),
  normal_clr: optNum(20, 40), normal_snf: optNum(6, 11), normal_conductivity_ms: optNum(2, 8),
  delivery_tolerance_points: optNum(0, 20), fat_bonus_per_point: optNum(0, 0.2), fat_bonus_cap: optNum(0, 0.5),
  grade_multipliers: z.object({ A: num(0, 3), B: num(0, 3) }).optional(),
  delivery_fee_etb: optNum(0, 10000), platform_commission_percent: optNum(0, 50),
}).strict().refine((v) => v.grade_a_max_water === undefined || v.grade_b_max_water === undefined || v.grade_a_max_water < v.grade_b_max_water, 'Grade A threshold must be below Grade B threshold');
export const calibrationSampleSchema = z.object({ lactometer_reading: num(10, 45), temperature_c: num(0, 45), known_water_percent: num(0, 100) });
export const previewSchema = testSchema.pick({ lactometer_reading: true, temperature_c: true, fat_percent: true, conductivity_ms: true });

// ---- Buyer marketplace, products, cart, orders ----
const uuidOpt = uuid.optional();
export const productSchema = z.object({
  name: text(120), category_id: uuidOpt, description: optText(1000), unit: z.enum(['kg', 'litre', 'piece']).default('kg'),
  price: num(0.01, 1000000), stock: num(0, 1000000), location_text: optText(120), image_url: imageUrl.optional(), quality_note: optText(300),
});
export const productUpdateSchema = productSchema.partial().extend({ status: z.enum(['available', 'hidden']).optional() }).strict();
export const productQuerySchema = z.object({
  search: z.string().trim().max(80).optional(), category_id: uuidOpt, region: z.string().trim().max(80).optional(),
  min_price: optNum(0, 1000000), max_price: optNum(0, 1000000), in_stock: z.enum(['true', 'false']).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest']).default('newest'), seller_id: uuidOpt,
});
export const cartAddSchema = z.object({ product_id: uuid, quantity: num(0.01, 100000) });
export const cartUpdateSchema = z.object({ quantity: num(0.01, 100000) });
export const addressSchema = z.object({
  label: optText(40), address: text(250), city: optText(80), region: optText(80),
  latitude: optNum(-90, 90), longitude: optNum(-180, 180), is_default: z.boolean().optional(),
});
export const addressUpdateSchema = addressSchema.partial().strict();
export const checkoutSchema = z.object({
  delivery_option: z.enum(['delivery', 'self_pickup']).default('delivery'),
  address_id: uuidOpt, delivery_address: optText(250), delivery_notes: optText(300),
}).refine((v) => v.delivery_option === 'self_pickup' || v.address_id || v.delivery_address, 'Choose a delivery address or switch to self pickup');
export const reviewSchema = z.object({
  order_kind: z.enum(['milk', 'product']), order_id: uuid,
  product_rating: z.coerce.number().int().min(1).max(5), delivery_rating: z.coerce.number().int().min(1).max(5).optional(), review: optText(1000),
});
export const sellerOrderStatusSchema = z.object({ status: z.enum(['confirmed', 'processing', 'ready_for_pickup', 'delivered']) });
export const dpActionSchema = z.object({ stage: z.enum(['start', 'confirm']).optional() });
export const dpCompleteSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit confirmation code'), notes: optText(500), photo_url: imageUrl.optional() });
export const dpLocationSchema = z.object({ latitude: num(-90, 90), longitude: num(-180, 180) });
export const dpAvailabilitySchema = z.object({ availability_status: z.enum(['available', 'busy', 'offline']) });
export const dpProfileSchema = z.object({
  full_name: text(120).optional(), phone: phone.optional(),
  company_name: optText(), vehicle_type: optText(80), plate_number: optText(30),
  capacity_litres: z.coerce.number().int().min(1).max(100000).optional(), has_cold_storage: z.boolean().optional(), service_area: optText(),
}).strict();
export const categorySchema = z.object({ name: text(60), active: z.boolean().optional() });
export const categoryUpdateSchema = categorySchema.partial().strict();
export const adminAssignSchema = z.object({ order_kind: z.enum(['milk', 'product']), order_id: uuid, transporter_id: uuid, instructions: optText(300) });
export const adminProductUpdateSchema = z.object({ status: z.enum(['available', 'hidden']) });
export const assistantSchema = z.object({ message: text(500), channel: z.enum(['text', 'voice']).default('text') });
export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(100),
  new_password: z.string().min(8).max(100).regex(/[A-Za-z]/, 'Password needs a letter').regex(/[0-9]/, 'Password needs a digit'),
});
export const notificationReadSchema = z.object({ ids: z.array(uuid).max(200).optional() });
