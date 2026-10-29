package com.syncvault.core

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import java.io.File

/**
 * SQLite in WAL mode stored in noBackupFilesDir: the Keystore key is not backed up,
 * so restoring an encrypted DB onto another device would only produce undecryptable rows.
 * Schema migrations are the shared files in assets/sync_vault/NNN_*.sql.
 */
class OutboxDatabase private constructor(private val context: Context, path: String) :
    SQLiteOpenHelper(context, path, null, 1) {

    override fun onConfigure(db: SQLiteDatabase) {
        db.enableWriteAheadLogging()
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onCreate(db: SQLiteDatabase) = Unit

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    override fun onOpen(db: SQLiteDatabase) {
        super.onOpen(db)
        migrate(context, db)
    }

    companion object {
        const val ASSET_DIR = "sync_vault"
        const val V1_DB_NAME = "offline_queue.db"
        private val MIGRATION_FILE = Regex("^(\\d{3})_.*\\.sql$")

        fun open(context: Context): OutboxDatabase {
            val dir = File(context.noBackupFilesDir, "sync_vault").apply { mkdirs() }
            val path = File(dir, "sync_vault.db").absolutePath
            importV1IfPresent(context, path)
            return OutboxDatabase(context.applicationContext, path)
        }

        fun splitStatements(sql: String): List<String> =
            sql.split(Regex("^--;;\\s*$", RegexOption.MULTILINE))
                .map { chunk -> chunk.lines().filterNot { it.trimStart().startsWith("--") }.joinToString("\n").trim() }
                .filter { it.isNotEmpty() }

        private fun readAsset(context: Context, name: String): String =
            context.assets.open("$ASSET_DIR/$name").bufferedReader().use { it.readText() }

        fun migrate(context: Context, db: SQLiteDatabase) {
            db.execSQL("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)")
            val applied = HashSet<Int>()
            db.rawQuery("SELECT version FROM schema_migrations", null).use { c ->
                while (c.moveToNext()) applied.add(c.getInt(0))
            }
            val files = (context.assets.list(ASSET_DIR) ?: emptyArray())
                .mapNotNull { name -> MIGRATION_FILE.matchEntire(name)?.let { it.groupValues[1].toInt() to name } }
                .sortedBy { it.first }
            for ((version, name) in files) {
                if (version in applied) continue
                val sql = readAsset(context, name)
                db.beginTransaction()
                try {
                    splitStatements(sql).forEach { db.execSQL(it) }
                    db.execSQL(
                        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                        arrayOf<Any>(version, System.currentTimeMillis()),
                    )
                    db.setTransactionSuccessful()
                } finally {
                    db.endTransaction()
                }
            }
        }

        /**
         * One-time import of unfinished requests from the v1 offline_queue.db, using the shared
         * import_v1.sql. Runs on a short-lived non-WAL connection because ATTACH permanently
         * disables WAL on an Android SQLiteDatabase instance.
         */
        private fun importV1IfPresent(context: Context, path: String) {
            val v1 = context.getDatabasePath(V1_DB_NAME)
            if (!v1.exists()) return
            var db: SQLiteDatabase? = null
            try {
                db = SQLiteDatabase.openOrCreateDatabase(path, null)
                migrate(context, db)
                val done = db.rawQuery("SELECT value FROM kv WHERE key = 'v1_imported'", null).use { it.moveToFirst() }
                if (!done) {
                    db.execSQL("ATTACH DATABASE ? AS v1", arrayOf<Any>(v1.absolutePath))
                    try {
                        db.beginTransaction()
                        try {
                            val now = System.currentTimeMillis()
                            db.execSQL(splitStatements(readAsset(context, "import_v1.sql")).single(), arrayOf<Any>(now))
                            db.execSQL("INSERT OR REPLACE INTO kv (key, value) VALUES ('v1_imported', ?)", arrayOf<Any>(now.toString()))
                            db.setTransactionSuccessful()
                        } finally {
                            db.endTransaction()
                        }
                    } finally {
                        db.execSQL("DETACH DATABASE v1")
                    }
                }
                db.close()
                db = null
                v1.renameTo(File(v1.parentFile, "$V1_DB_NAME.migrated"))
            } catch (e: Exception) {
                // Leave the v1 file in place so the import is retried on the next launch.
                Log.e("SyncVault", "v1 import failed", e)
            } finally {
                db?.close()
            }
        }
    }
}
