/** TEMPORAER (Nachweis 0028 auf der Preview): Migrations-Journal lesen, nur SELECT. */
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false });
const [z] = await sql`select count(*)::int as n, count(distinct hash)::int as hashes from drizzle.__drizzle_migrations`;
const letzte = await sql`select id, created_at::text as created_at from drizzle.__drizzle_migrations order by id desc limit 3`;
const dup = await sql`select hash, count(*)::int as n from drizzle.__drizzle_migrations group by hash having count(*) > 1`;
console.log("JOURNAL " + JSON.stringify({ ...z, letzte, doppelte: dup.length }));
await sql.end();
