import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
const password=process.env.DEMO_PASSWORD;
if(!password) { console.error('DEMO_PASSWORD is required'); process.exit(1); }
const c=await db.connect();
try {
 await c.query('BEGIN');
 const existing=await c.query('SELECT COUNT(*)::int n FROM stock_movements');
 if(existing.rows[0].n) { console.log('Seed already present; leaving existing data untouched'); await c.query('COMMIT'); process.exit(0); }
 const hash=await bcrypt.hash(password,12);
 for(const [email,role] of [['salesa@example.test','SALESMAN'],['salesb@example.test','SALESMAN'],['admin@example.test','ADMIN'],['production@example.test','PRODUCTION'],['auditor@example.test','AUDITOR'],['owner@example.test','OWNER']]) await c.query('INSERT INTO users(email,password_hash,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING',[email,hash,role]);
 const items=[['FLOUR','Flour','RAW','kg','42',null,0,100],['OIL','Cooking oil','RAW','litre','140',null,0,30],['SPICE','Salt and spice mix','RAW','kg','200',null,0,5],['POUCH','200 g pouch','PACKAGING','piece','2.5',null,0,500],['CARTON','Carton','PACKAGING','piece','15',null,0,30],['MURUKKU200','Murukku 200 g','FINISHED','packet','0','50',5,50]];
 const ids={};
 for(const [sku,name,kind,unit,price,selling,gst,opening] of items){const r=await c.query('INSERT INTO items(sku,name,kind,unit,price,selling_price,gst_rate) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[sku,name,kind,unit,price,selling,gst]); ids[sku]=r.rows[0].id; await c.query('INSERT INTO stock_movements(item_id,delta,source_type,source_id,line_key,unit_cost) VALUES($1,$2,$3,$4,$5,$6)',[ids[sku],opening,'OPENING',1,sku,price]);}
 await c.query("INSERT INTO customers(name,state_code) VALUES('Retailer A','33'),('Distributor B','29')");
 const b=await c.query('INSERT INTO bom(finished_item_id,expected_output) VALUES($1,200) RETURNING id',[ids.MURUKKU200]);
 for(const [sku,qty] of [['FLOUR',40],['OIL',10],['SPICE',1.2],['POUCH',200],['CARTON',10]]) await c.query('INSERT INTO bom_lines(bom_id,item_id,planned_qty) VALUES($1,$2,$3)',[b.rows[0].id,ids[sku],qty]);
 await c.query('COMMIT'); console.log('Seeded benchmark master data and six role accounts');
} catch(e){await c.query('ROLLBACK'); console.error(e);process.exitCode=1;} finally {c.release();await db.end();}
