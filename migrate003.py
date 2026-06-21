import asyncio
import asyncpg
import sys

DATABASE_URL = sys.argv[1]

async def run():
    conn = await asyncpg.connect(DATABASE_URL)
    await conn.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'analyst_predictions_match_analyst_unique'
            ) THEN
                ALTER TABLE analyst_predictions
                ADD CONSTRAINT analyst_predictions_match_analyst_unique
                UNIQUE (match_id, analyst_id);
            END IF;
        END
        $$;
    """)
    await conn.close()
    print("Done.")

asyncio.run(run())
