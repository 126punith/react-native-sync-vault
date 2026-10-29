package com.syncvault.core

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * WorkManager wiring. Work survives process death, reboots and Doze, so a queued request is
 * always eventually attempted once a network is available, even if the app never reopens.
 */
object BackgroundScheduler {
    private const val DRAIN = "sync-vault-drain"
    private const val RETRY = "sync-vault-retry"
    private const val PERIODIC = "sync-vault-periodic"

    private fun constraints(unmetered: Boolean, charging: Boolean) = Constraints.Builder()
        .setRequiredNetworkType(if (unmetered) NetworkType.UNMETERED else NetworkType.CONNECTED)
        .setRequiresCharging(charging)
        .build()

    /** Immediate drain once constraints are met. Expedited work cannot require charging. */
    fun enqueueDrain(context: Context, config: VaultConfig, expedited: Boolean) {
        val builder = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints(config.wifiOnly, config.requiresCharging))
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        if (expedited && !config.requiresCharging) {
            builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
        }
        WorkManager.getInstance(context).enqueueUniqueWork(DRAIN, ExistingWorkPolicy.KEEP, builder.build())
    }

    /** Wakes the engine when the earliest backed-off request becomes ready. */
    fun scheduleRetry(context: Context, config: VaultConfig, delayMs: Long) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints(config.wifiOnly, config.requiresCharging))
            .setInitialDelay(delayMs.coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(RETRY, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancelRetry(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(RETRY)
    }

    /** Safety net in case every other trigger is missed. Android enforces a 15 minute minimum. */
    fun schedulePeriodic(context: Context, intervalMinutes: Int, unmetered: Boolean, charging: Boolean) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(intervalMinutes.coerceAtLeast(15).toLong(), TimeUnit.MINUTES)
            .setConstraints(constraints(unmetered, charging))
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancelPeriodic(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
    }

    fun foregroundInfo(context: Context, title: String): ForegroundInfo {
        val channelId = "sync_vault"
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(channelId) == null) {
            nm.createNotificationChannel(NotificationChannel(channelId, "Background sync", NotificationManager.IMPORTANCE_LOW))
        }
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle(title)
            .setOngoing(true)
            .setSilent(true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    private const val NOTIFICATION_ID = 0x5A11
}

class SyncWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val core = SyncVaultCore.getInstance(applicationContext)
        if (core.hasLargePending()) {
            try {
                setForeground(getForegroundInfo())
            } catch (_: Exception) {
                // Android 12+ may refuse foreground starts from the background; drain anyway.
            }
        }
        core.drain("worker")
        return Result.success()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        val core = SyncVaultCore.getInstance(applicationContext)
        return BackgroundScheduler.foregroundInfo(applicationContext, core.currentConfig().notificationTitle)
    }
}
