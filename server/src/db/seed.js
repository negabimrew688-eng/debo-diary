import bcrypt from 'bcrypt';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { migrate } from './migrate.js';
import { DEFAULT_SETTINGS } from '../services/settings.service.js';
import { assess } from '../services/milkQuality.service.js';
import { recomputeReputation } from '../services/reputation.service.js';
import { deliveryCode, hashCode } from '../services/delivery.service.js';

export const DEMO_PASSWORD = 'Debo2026pass';

export async function seed() {
  if (env.nodeEnv === 'production') throw new Error('Refusing to seed demo data in production');
  await migrate({ quiet: true });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`TRUNCATE users, system_settings, audit_logs, calibration_samples RESTART IDENTITY CASCADE`);
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const mk = async (email, name, role, phone, region, woreda) =>
      (await c.query(`INSERT INTO users(email,password_hash,full_name,role,phone,region,woreda,fayda_verified) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [email, hash, name, role, phone, region, woreda, role !== 'admin' && Math.random() > 0.3])).rows[0].id;

    const admin = await mk('admin@debodairy.test', 'Debo Admin', 'admin', '+251911000001', 'Amhara', 'Gondar');
    const f1 = await mk('almaz@debodairy.test', 'Almaz Tesfaye', 'farmer', '+251911100001', 'Amhara', 'Gondar Zuria');
    const f2 = await mk('bekele@debodairy.test', 'Bekele Mulu', 'farmer', '+251911100002', 'Amhara', 'Azezo');
    const f3 = await mk('tigist@debodairy.test', 'Tigist Alemu', 'farmer', '+251911100003', 'Amhara', 'Maksegnit');
    const b1 = await mk('processor@debodairy.test', 'Gondar Dairy Processing', 'buyer', '+251911200001', 'Amhara', 'Gondar');
    const b2 = await mk('cafe@debodairy.test', 'Selam Cafe', 'buyer', '+251911200002', 'Amhara', 'Gondar');
    const sup = await mk('feed@debodairy.test', 'Amhara Feed Supply', 'feed_supplier', '+251911300001', 'Amhara', 'Gondar');
    const t1 = await mk('transport1@debodairy.test', 'Dawit Transport', 'transporter', '+251911400001', 'Amhara', 'Gondar');
    const t2 = await mk('transport2@debodairy.test', 'Chilled Milk Logistics', 'transporter', '+251911400002', 'Amhara', 'Azezo');

    await c.query(`INSERT INTO farmer_profiles(user_id,farm_name,location_text) VALUES ($1,'Almaz Dairy Farm','Gondar Zuria'),($2,'Bekele Farm','Azezo'),($3,'Tigist Cows','Maksegnit')`, [f1, f2, f3]);
    await c.query(`INSERT INTO buyer_profiles(user_id,buyer_type,org_name,address) VALUES ($1,'processor','Gondar Dairy Processing PLC','Gondar city'),($2,'individual','Selam Cafe','Piazza, Gondar')`, [b1, b2]);
    await c.query(`INSERT INTO supplier_profiles(user_id,business_name,address) VALUES ($1,'Amhara Feed Supply','Gondar')`, [sup]);
    await c.query(`INSERT INTO transporter_profiles(user_id,company_name,vehicle_type,plate_number,capacity_litres,has_cold_storage,service_area) VALUES
      ($1,'Dawit Transport','Isuzu pickup','AM-12345',600,false,'Amhara, Gondar'),($2,'Chilled Milk Logistics','Insulated van','AM-67890',1500,true,'Amhara, Azezo, Gondar')`, [t1, t2]);

    for (const [f, cows] of [[f1, [['A-001','Holstein cross',48,true,14],['A-002','Fogera',60,true,8],['A-003','Local zebu',72,true,4]]],
                              [f2, [['B-001','Holstein cross',40,true,12],['B-002','Local zebu',84,false,0]]],
                              [f3, [['T-001','Jersey cross',36,true,10],['T-002','Fogera',50,true,7]]]]) {
      for (const [tag, breed, age, lact, y] of cows) {
        await c.query(`INSERT INTO cows(farmer_id,tag,breed,age_months,lactating,daily_yield_litres) VALUES ($1,$2,$3,$4,$5,$6)`, [f, tag, breed, age, lact, y]);
      }
    }

    const feeds = [
      ['Dairy concentrate 18%', 'Balanced concentrate for high-yield cows', 'concentrate', 38, 4000, 18],
      ['Dairy concentrate 16%', 'Everyday lactating cow ration', 'concentrate', 32, 6000, 16],
      ['Wheat bran', 'Fibre and energy supplement', 'by_product', 22, 8000, 14],
      ['Noug cake', 'High protein oilseed cake', 'by_product', 45, 2500, 30],
      ['Mineral lick block', 'Calcium, phosphorus and trace minerals', 'mineral', 60, 800, null],
    ];
    for (const [n, d, cat, p, s, pr] of feeds) {
      await c.query(`INSERT INTO feed_products(supplier_id,name,description,category,price_per_kg,stock_kg,protein_percent) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [sup, n, d, cat, p, s, pr]);
    }
    await c.query(`INSERT INTO byproduct_listings(farmer_id,kind,description,quantity_kg,price_per_kg) VALUES ($1,'compost','Matured cow-manure compost, sieved',2000,4),($2,'cow_manure','Fresh manure for biogas or compost',1500,1.5)`, [f1, f2]);

    // Batches with real Milk Check results
    const S = DEFAULT_SETTINGS;
    const mkBatch = async (farmer, litres, loc, readings, status, hoursAgo = 1) => {
      const a = assess({ lactometer: readings.l, temperature: readings.t, fat: readings.fat, conductivity: readings.cond }, S);
      const produced = new Date(Date.now() - hoursAgo * 3600e3);
      const b = (await c.query(
        `INSERT INTO milk_batches(farmer_id,volume_litres,remaining_litres,produced_at,collection_location,grade,recommended_price,asking_price,status)
         VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [farmer, litres, produced, loc, a.grade, a.recommended_price, status === 'listed' ? a.recommended_price : null, status])).rows[0].id;
      await c.query(
        `INSERT INTO milk_tests(batch_id,tested_by,test_type,lactometer_reading,temperature_c,fat_percent,conductivity_ms,corrected_reading,estimated_water_percent,estimate_low,estimate_high,snf_estimated,confidence,method,flags,grade,recommended_price)
         VALUES ($1,$2,'producer',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [b, farmer, readings.l, readings.t, readings.fat ?? null, readings.cond ?? null, a.corrected_reading, a.estimated_water_percent, a.estimate_low, a.estimate_high, a.snf_estimated, a.confidence, a.method, JSON.stringify(a.flags), a.grade, a.recommended_price]);
      return b;
    };
    const batchA = await mkBatch(f1, 120, 'Gondar Zuria, Teda road collection point', { l: 29.5, t: 20, fat: 3.9, cond: 4.5 }, 'listed');
    await mkBatch(f2, 80, 'Azezo cooperative gate', { l: 27.5, t: 21, fat: 3.4 }, 'listed');
    await mkBatch(f3, 60, 'Maksegnit market', { l: 26.5, t: 20, fat: 3.3 }, 'listed', 2);
    await mkBatch(f3, 40, 'Maksegnit market', { l: 21, t: 20 }, 'rejected', 3);

    // Completed order history for dashboards
    const done = (await c.query(
      `INSERT INTO orders(batch_id,buyer_id,farmer_id,volume_litres,unit_price,total_amount,agreed_grade,delivery_address,status,created_at)
       VALUES ($1,$2,$3,30,50,1500,'A','Gondar Dairy Processing, Gondar','completed', now() - interval '3 days') RETURNING id`, [batchA, b1, f1])).rows[0].id;
    await c.query(`UPDATE milk_batches SET remaining_litres = remaining_litres - 30 WHERE id=$1`, [batchA]);
    await c.query(`INSERT INTO payments(order_id,reference,amount,status,mode) VALUES ($1,'TB-SBX-SEEDDONE001',1500,'released','sandbox')`, [done]);
    await c.query(`INSERT INTO deliveries(order_id,transporter_id,status,collected_at,delivered_at) VALUES ($1,$2,'delivered', now() - interval '3 days', now() - interval '3 days')`, [done, t2]);

    // Dairy product catalogue, addresses and a little order history
    const cat = Object.fromEntries((await c.query('SELECT id, name FROM product_categories')).rows.map((r) => [r.name, r.id]));
    const prod = async (seller, category, name, desc, unit, price, stock, loc) =>
      (await c.query(`INSERT INTO dairy_products(seller_id,category_id,name,description,unit,price,stock,location_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [seller, cat[category], name, desc, unit, price, stock, loc])).rows[0].id;
    const butter1 = await prod(f1, 'Butter', 'Fresh farm butter', 'Churned from cow milk, unsalted', 'kg', 620, 15, 'Gondar Zuria');
    await prod(f1, 'Ayib (cottage cheese)', 'Ayib', 'Soft fresh cottage cheese', 'kg', 180, 20, 'Gondar Zuria');
    await prod(f1, 'Ghee (niter kibbeh)', 'Spiced niter kibbeh', 'Traditional clarified butter with spices', 'kg', 950, 8, 'Gondar Zuria');
    await prod(f2, 'Yoghurt', 'Natural yoghurt (ergo)', 'Set yoghurt, no sugar', 'litre', 90, 30, 'Azezo');
    await prod(f2, 'Cheese', 'Aged cheese', 'Hard cheese, 3 months', 'kg', 450, 6, 'Azezo');
    await prod(f2, 'Milk', 'Pasteurised milk', 'Packed in clean bottles', 'litre', 65, 50, 'Azezo');
    await prod(f3, 'Butter', 'Butter (small batch)', 'Hand-churned', 'kg', 590, 10, 'Maksegnit');
    await prod(f3, 'Ayib (cottage cheese)', 'Ayib', 'Fresh daily', 'kg', 160, 25, 'Maksegnit');
    await c.query(`INSERT INTO buyer_addresses(buyer_id,label,address,city,region,is_default) VALUES ($1,'Processing plant','Industrial area','Gondar','Amhara',TRUE),($2,'Cafe','Piazza','Gondar','Amhara',TRUE)`, [b1, b2]);

    const po = (await c.query(
      `INSERT INTO product_orders(tracking_number,buyer_id,seller_id,status,payment_status,payment_reference,total_amount,delivery_option,delivery_address,pickup_location,buyer_confirmed_at,created_at)
       VALUES ('DD-SEED-0001',$1,$2,'delivered','paid','TB-SBX-SEEDPROD001',1240,'delivery','Piazza, Gondar, Amhara','Gondar Zuria', now() - interval '2 days', now() - interval '3 days') RETURNING id`, [b2, f1])).rows[0].id;
    await c.query(`INSERT INTO product_order_items(product_order_id,product_id,name,unit,unit_price,quantity) VALUES ($1,$2,'Fresh farm butter','kg',620,2)`, [po, butter1]);
    for (const st of ['pending', 'paid', 'confirmed', 'processing', 'ready_for_pickup', 'assigned', 'in_transit', 'delivered']) await c.query(`INSERT INTO order_events(order_kind,order_id,status,created_at) VALUES ('product',$1,$2, now() - interval '3 days' + (random() * interval '20 hours'))`, [po, st]);
    const d = (await c.query(
      `INSERT INTO deliveries(product_order_id,transporter_id,status,pickup_location,destination_address,delivery_fee,accepted_at,collected_at,in_transit_at,delivered_at)
       VALUES ($1,$2,'delivered','Gondar Zuria','Piazza, Gondar, Amhara',80, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', now() - interval '3 days' + interval '1 hour', now() - interval '3 days' + interval '2 hours') RETURNING id`, [po, t1])).rows[0].id;
    await c.query(`INSERT INTO delivery_proofs(delivery_id,confirmation_code_hash,delivered_at,buyer_confirmed_at) VALUES ($1,$2, now() - interval '3 days' + interval '2 hours', now() - interval '2 days')`, [d, hashCode(d, deliveryCode(d))]);
    await c.query(`INSERT INTO delivery_earnings(delivery_id,partner_id,amount,payment_status) VALUES ($1,$2,80,'pending')`, [d, t1]);
    await c.query(`INSERT INTO buyer_reviews(buyer_id,seller_id,product_order_id,product_rating,delivery_rating,review) VALUES ($1,$2,$3,5,4,'Fresh butter, delivered on time.')`, [b2, f1, po]);
    const po2 = (await c.query(
      `INSERT INTO product_orders(tracking_number,buyer_id,seller_id,status,payment_status,payment_reference,total_amount,delivery_option,delivery_address,pickup_location)
       VALUES ('DD-SEED-0002',$1,$2,'processing','paid','TB-SBX-SEEDPROD002',450,'delivery','Gondar Dairy Processing, Gondar','Azezo') RETURNING id`, [b1, f2])).rows[0].id;
    await c.query(`INSERT INTO product_order_items(product_order_id,product_id,name,unit,unit_price,quantity) SELECT $1, id, name, unit, price, 1 FROM dairy_products WHERE name='Aged cheese'`, [po2]);
    for (const st of ['pending', 'paid', 'confirmed', 'processing']) await c.query(`INSERT INTO order_events(order_kind,order_id,status) VALUES ('product',$1,$2)`, [po2, st]);
    await c.query(`UPDATE dairy_products SET stock = stock - 1 WHERE name='Aged cheese'`);
    await c.query(`INSERT INTO notifications(user_id,type,title,body,link) VALUES ($1,'order_status','Order is being prepared','Order DD-SEED-0002: the seller is preparing your order.','/buyer/orders/product/${po2}')`, [b1]);

    for (const f of [f1, f2, f3]) await recomputeReputation(c, f);
    await c.query('COMMIT');
    return { admin };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed()
    .then(() => {
      console.log(`Seeded demo data. All demo accounts use password: ${DEMO_PASSWORD}`);
      console.log('Accounts: admin@ almaz@ bekele@ tigist@ processor@ cafe@ feed@ transport1@ transport2@  (…@debodairy.test)');
      return pool.end();
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
