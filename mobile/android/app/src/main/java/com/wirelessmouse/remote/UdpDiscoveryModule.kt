package com.wirelessmouse.remote

import android.content.Context
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

class UdpDiscoveryModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "UdpDiscoveryModule"
    }

    @ReactMethod
    fun discoverServers(discoveryPort: Int, timeoutMs: Int, promise: Promise) {
        Thread {
            var socket: DatagramSocket? = null
            var multicastLock: WifiManager.MulticastLock? = null
            try {
                val wifiManager = reactApplicationContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                if (wifiManager != null) {
                    multicastLock = wifiManager.createMulticastLock("udp_discovery_lock")
                    multicastLock.setReferenceCounted(true)
                    multicastLock.acquire()
                }

                socket = DatagramSocket()
                socket.broadcast = true
                socket.soTimeout = timeoutMs

                val requestData = "WM_DISCOVER_V1".toByteArray(Charsets.UTF_8)
                val broadcastAddr = InetAddress.getByName("255.255.255.255")
                val sendPacket = DatagramPacket(requestData, requestData.size, broadcastAddr, discoveryPort)
                socket.send(sendPacket)

                val results: WritableArray = Arguments.createArray()
                val seenDevices = HashSet<String>()
                val buffer = ByteArray(1024)
                val startTime = System.currentTimeMillis()

                while (System.currentTimeMillis() - startTime < timeoutMs) {
                    try {
                        val receivePacket = DatagramPacket(buffer, buffer.size)
                        socket.receive(receivePacket)

                        val serverIp = receivePacket.address.hostAddress ?: continue
                        val rawMsg = String(receivePacket.data, 0, receivePacket.length, Charsets.UTF_8).trim()

                        if (rawMsg.startsWith("{")) {
                            val json = JSONObject(rawMsg)
                            val type = json.optString("type", "")
                            if (type == "wifi-mouse-discovery" || json.has("deviceId")) {
                                val deviceId = json.optString("deviceId", serverIp)
                                if (!seenDevices.contains(deviceId)) {
                                    seenDevices.add(deviceId)
                                    val item: WritableMap = Arguments.createMap()
                                    item.putString("ip", serverIp)
                                    item.putInt("port", json.optInt("httpPort", 41235))
                                    item.putInt("wsPort", json.optInt("wsPort", 41235))
                                    item.putInt("httpPort", json.optInt("httpPort", 41235))
                                    item.putString("deviceId", deviceId)
                                    item.putString("name", json.optString("name", json.optString("host", "Wi-Fi Mouse PC")))
                                    item.putString("host", json.optString("name", json.optString("host", "Wi-Fi Mouse PC")))
                                    item.putString("platform", json.optString("platform", "unknown"))
                                    results.pushMap(item)
                                }
                            }
                        }
                    } catch (e: SocketTimeoutException) {
                        break
                    } catch (e: Exception) {
                        // ignore packet parse errors
                    }
                }

                promise.resolve(results)
            } catch (e: Exception) {
                promise.reject("UDP_DISCOVERY_ERROR", e.message, e)
            } finally {
                try {
                    socket?.close()
                } catch (_: Exception) {}
                try {
                    if (multicastLock?.isHeld == true) {
                        multicastLock.release()
                    }
                } catch (_: Exception) {}
            }
        }.start()
    }
}
