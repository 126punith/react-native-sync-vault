package com.syncvault.core

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.util.Log

/**
 * Tracks the default network. "Connected" requires NET_CAPABILITY_VALIDATED so captive
 * portals and dead Wi-Fi do not trigger drains that are guaranteed to fail.
 */
class NetworkMonitor(context: Context, private val onChange: (NetworkSnapshot, Boolean) -> Unit) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    @Volatile
    var current: NetworkSnapshot = snapshot(null)
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = update(caps)
        override fun onLost(network: Network) = update(null)
        override fun onUnavailable() = update(null)
    }

    fun start() {
        current = snapshot(cm.activeNetwork?.let { cm.getNetworkCapabilities(it) })
        try {
            cm.registerDefaultNetworkCallback(callback)
        } catch (e: Exception) {
            Log.w("SyncVault", "Cannot register network callback", e)
        }
    }

    fun stop() {
        try {
            cm.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    fun refresh(): NetworkSnapshot {
        current = snapshot(cm.activeNetwork?.let { cm.getNetworkCapabilities(it) })
        return current
    }

    private fun update(caps: NetworkCapabilities?) {
        val previous = current
        val next = snapshot(caps)
        current = next
        if (next != previous) {
            onChange(next, !previous.isConnected && next.isConnected)
        }
    }

    private fun snapshot(caps: NetworkCapabilities?): NetworkSnapshot {
        if (caps == null) return NetworkSnapshot(false, false, "none", false, false)
        val internet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
            else -> "other"
        }
        val metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        val dataSaver = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
            cm.restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
        return NetworkSnapshot(
            isConnected = internet && validated,
            isInternetReachable = validated,
            type = type,
            isExpensive = metered,
            isConstrained = dataSaver,
        )
    }
}

object PowerMonitor {
    fun snapshot(context: Context): PowerSnapshot {
        val intent: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        return PowerSnapshot(
            batteryLevel = if (level >= 0 && scale > 0) level.toDouble() / scale else -1.0,
            isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL,
            isLowPowerMode = pm.isPowerSaveMode,
        )
    }
}
