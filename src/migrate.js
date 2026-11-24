
import 'dotenv/config';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

const migrationDirectory = new URL(
  '../migrations/',
  import.meta.url
);

const c = await db.connect();

try {
  const files = (await readdir(migrationDirectory))
    .filter(file => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`Applying migration: ${file}`);

    const sql = await readFile(
      new URL(file, migrationDirectory),
      'utf8'
    );

    await c.query(sql);

    console.log(`Migration successful: ${file}`);
  }

  console.log('All database migrations completed.');

} catch (error) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('Database migration failed:', error.message);
  process.exitCode = 1;

} finally {
  c.release();
  await db.end();
}
