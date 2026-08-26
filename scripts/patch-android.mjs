import fs from 'node:fs';
import path from 'node:path';

const VERSION_NAME = '1.10.25';
const VERSION_CODE = 11024;
const PACKAGE_NAME = 'com.randoradar.app';
const javaDir = `android/app/src/main/java/${PACKAGE_NAME.replaceAll('.', '/')}`;

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = fs.readFileSync(manifestPath, 'utf8');

const permissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION'
];

const missingPermissions = permissions.filter(
  permission => !manifest.includes(`android:name="${permission}"`)
);
if (missingPermissions.length) {
  const permissionXml = missingPermissions
    .map(permission => `    <uses-permission android:name="${permission}" />`)
    .join('\n');
  if (!manifest.includes('<application')) throw new Error('Balise <application> introuvable');
  manifest = manifest.replace(/\n\s*<application\b/, `\n${permissionXml}\n\n    <application`);
}

if (!manifest.includes('android:screenOrientation=')) {
  manifest = manifest.replace(
    /(<activity\b[^>]*android:name="\.MainActivity"[^>]*)(>)/s,
    '$1 android:screenOrientation="portrait"$2'
  );
}

const serviceXml = `\n        <service\n            android:name=".NativeLocationService"\n            android:enabled="true"\n            android:exported="false"\n            android:foregroundServiceType="location" />\n`;
if (!manifest.includes('android:name=".NativeLocationService"')) {
  manifest = manifest.replace(/\n\s*<\/application>/, `${serviceXml}    </application>`);
}
fs.writeFileSync(manifestPath, manifest);

const gradlePath = 'android/app/build.gradle';
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${VERSION_CODE}`);
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${VERSION_NAME}"`);
  if (!gradle.includes("com.google.android.gms:play-services-location:21.4.0")) {
    gradle = gradle.replace(/dependencies\s*\{/, `dependencies {\n    implementation 'com.google.android.gms:play-services-location:21.4.0'`);
  }
  fs.writeFileSync(gradlePath, gradle);
}

fs.mkdirSync(javaDir, { recursive: true });

const serviceJava = `package ${PACKAGE_NAME};

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class NativeLocationService extends Service {
    public static final String ACTION_START = "com.randoradar.app.START_TRACKING";
    public static final String ACTION_STOP = "com.randoradar.app.STOP_TRACKING";
    private static final String CHANNEL_ID = "randoradar_tracking";
    private static final int NOTIFICATION_ID = 4819;
    private static final String PREFS = "randoradar_native_tracker";

    private FusedLocationProviderClient fusedClient;
    private LocationCallback locationCallback;
    private String sessionId = "";
    private long minTimeMs = 2000L;
    private float minDistanceM = 2f;
    private float maxAccuracyM = 40f;
    private float maxSpeedKmh = 160f;
    private double lastLat = Double.NaN;
    private double lastLon = Double.NaN;
    private long lastTime = 0L;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedClient = LocationServices.getFusedLocationProviderClient(this);
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                List<Location> locations = new ArrayList<>(result.getLocations());
                Collections.sort(locations, Comparator.comparingLong(Location::getTime));
                for (Location location : locations) acceptLocation(location);
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            return START_NOT_STICKY;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (intent != null && ACTION_START.equals(intent.getAction())) {
            sessionId = safeSession(intent.getStringExtra("sessionId"));
            minTimeMs = Math.max(1000L, intent.getLongExtra("minTimeMs", 2000L));
            minDistanceM = Math.max(0f, intent.getFloatExtra("minDistanceM", 2f));
            maxAccuracyM = Math.max(10f, intent.getFloatExtra("maxAccuracyM", 40f));
            maxSpeedKmh = Math.max(20f, intent.getFloatExtra("maxSpeedKmh", 160f));
            long requestedStartedAt = intent.getLongExtra("startedAt", 0L);
            long startedAt = requestedStartedAt > 0L ? requestedStartedAt : prefs.getLong("startedAt", System.currentTimeMillis());
            String mode = intent.getStringExtra("mode");
            String activityName = intent.getStringExtra("activityName");
            prefs.edit()
                .putBoolean("active", true)
                .putString("sessionId", sessionId)
                .putLong("startedAt", startedAt)
                .putString("mode", mode == null ? prefs.getString("mode", "hike") : mode)
                .putString("activityName", activityName == null ? prefs.getString("activityName", "") : activityName)
                .putLong("lastServiceStartAt", System.currentTimeMillis())
                .putLong("minTimeMs", minTimeMs)
                .putFloat("minDistanceM", minDistanceM)
                .putFloat("maxAccuracyM", maxAccuracyM)
                .putFloat("maxSpeedKmh", maxSpeedKmh)
                .apply();
        } else {
            if (!prefs.getBoolean("active", false)) return START_NOT_STICKY;
            sessionId = safeSession(prefs.getString("sessionId", ""));
            minTimeMs = prefs.getLong("minTimeMs", 2000L);
            minDistanceM = prefs.getFloat("minDistanceM", 2f);
            maxAccuracyM = prefs.getFloat("maxAccuracyM", 40f);
            maxSpeedKmh = prefs.getFloat("maxSpeedKmh", 160f);
        }

        if (sessionId.isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        promoteToForeground();
        loadLastAcceptedPoint();
        startLocationUpdates();
        return START_STICKY;
    }

    private void promoteToForeground() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Suivi GPS Rando Radar",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Enregistrement d’une activité GPS en arrière-plan");
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, open, pendingFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Rando Radar · activité en cours")
            .setContentText("GPS haute précision actif · écran éteint compris")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopTracking();
            return;
        }

        try { fusedClient.removeLocationUpdates(locationCallback); } catch (Exception ignored) {}

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, minTimeMs)
            .setMinUpdateIntervalMillis(Math.max(1000L, minTimeMs / 2L))
            .setMinUpdateDistanceMeters(minDistanceM)
            .setMaxUpdateDelayMillis(Math.max(3000L, minTimeMs * 2L))
            .build();

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            stopTracking();
        }
    }

    private void acceptLocation(Location location) {
        if (location == null) return;
        float accuracy = location.hasAccuracy() ? location.getAccuracy() : 9999f;
        if (accuracy <= 0 || accuracy > maxAccuracyM) return;

        long timestamp = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        if (lastTime > 0 && timestamp <= lastTime) return;

        double lat = location.getLatitude();
        double lon = location.getLongitude();
        float distanceM = 0f;
        double computedKmh = 0d;

        if (!Double.isNaN(lastLat) && !Double.isNaN(lastLon) && lastTime > 0) {
            float[] result = new float[1];
            Location.distanceBetween(lastLat, lastLon, lat, lon, result);
            distanceM = Math.max(0f, result[0]);
            double dtSeconds = Math.max(0.5d, (timestamp - lastTime) / 1000d);
            computedKmh = (distanceM / dtSeconds) * 3.6d;

            if (computedKmh > maxSpeedKmh) return;
            if (location.hasSpeed() && location.getSpeed() >= 0 && location.getSpeed() * 3.6d > maxSpeedKmh * 1.25d) return;

            // Très faible déplacement = bruit GPS. Au-delà de 15 s on garde quand même un point,
            // afin de ne jamais créer un long trou dans la trace quand l'écran est éteint.
            double jitterM = Math.max(1.2d, Math.min(5d, accuracy * 0.20d));
            if (distanceM < jitterM && (timestamp - lastTime) < 15000L) return;
        }

        try {
            JSONObject point = new JSONObject();
            point.put("lat", lat);
            point.put("lon", lon);
            point.put("accuracy", accuracy);
            point.put("timestamp", timestamp);
            point.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
            point.put("speedKmh", location.hasSpeed() && location.getSpeed() >= 0 ? location.getSpeed() * 3.6d : computedKmh);
            point.put("bearing", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
            point.put("provider", "fused");
            appendLine(point.toString());
            lastLat = lat;
            lastLon = lon;
            lastTime = timestamp;
        } catch (Exception ignored) {}
    }

    private void appendLine(String line) throws Exception {
        File file = trackFile(sessionId);
        try (FileOutputStream fos = new FileOutputStream(file, true)) {
            fos.write((line + "\\n").getBytes(StandardCharsets.UTF_8));
            fos.flush();
        }
    }

    private void loadLastAcceptedPoint() {
        lastLat = Double.NaN;
        lastLon = Double.NaN;
        lastTime = 0L;
        File file = trackFile(sessionId);
        if (!file.exists()) return;
        String last = null;
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) if (!line.trim().isEmpty()) last = line;
            if (last != null) {
                JSONObject p = new JSONObject(last);
                lastLat = p.getDouble("lat");
                lastLon = p.getDouble("lon");
                lastTime = p.getLong("timestamp");
            }
        } catch (Exception ignored) {}
    }

    private File trackFile(String id) {
        return new File(getFilesDir(), "rr-track-" + safeSession(id) + ".jsonl");
    }

    private String safeSession(String raw) {
        if (raw == null) return "";
        String clean = raw.replaceAll("[^A-Za-z0-9_-]", "");
        return clean.substring(0, Math.min(clean.length(), 80));
    }

    private void stopTracking() {
        try { if (fusedClient != null && locationCallback != null) fusedClient.removeLocationUpdates(locationCallback); } catch (Exception ignored) {}
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("active", false).apply();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        stopSelf();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        try { if (fusedClient != null && locationCallback != null) fusedClient.removeLocationUpdates(locationCallback); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
`;

const pluginJava = `package ${PACKAGE_NAME};

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.content.Context;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;

@CapacitorPlugin(name = "RandoRadarTracker")
public class RandoRadarTrackerPlugin extends Plugin {

    @PluginMethod
    public void startTracking(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("LOCATION_PERMISSION_REQUIRED");
            return;
        }

        String sessionId = safeSession(call.getString("sessionId", ""));
        if (sessionId.isEmpty()) {
            call.reject("SESSION_REQUIRED");
            return;
        }

        Boolean clear = call.getBoolean("clear", false);
        if (Boolean.TRUE.equals(clear)) clearOldTracks();

        int minTimeMs = call.getInt("minTimeMs", 2000);
        double minDistanceM = call.getDouble("minDistanceM", 2.0);
        double maxAccuracyM = call.getDouble("maxAccuracyM", 40.0);
        double maxSpeedKmh = call.getDouble("maxSpeedKmh", 160.0);
        long startedAt = 0L;
        Double startedAtRaw = call.getDouble("startedAt");
        if (startedAtRaw != null && startedAtRaw > 0) startedAt = startedAtRaw.longValue();
        String mode = call.getString("mode", "hike");
        String activityName = call.getString("activityName", "");

        getContext().getSharedPreferences("randoradar_native_tracker", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("active", true)
            .putString("sessionId", sessionId)
            .putLong("startedAt", startedAt > 0 ? startedAt : System.currentTimeMillis())
            .putString("mode", mode == null ? "hike" : mode)
            .putString("activityName", activityName == null ? "" : activityName)
            .apply();

        Intent service = new Intent(getContext(), NativeLocationService.class);
        service.setAction(NativeLocationService.ACTION_START);
        service.putExtra("sessionId", sessionId);
        service.putExtra("minTimeMs", (long) minTimeMs);
        service.putExtra("minDistanceM", (float) minDistanceM);
        service.putExtra("maxAccuracyM", (float) maxAccuracyM);
        service.putExtra("maxSpeedKmh", (float) maxSpeedKmh);
        service.putExtra("startedAt", startedAt);
        service.putExtra("mode", mode);
        service.putExtra("activityName", activityName);
        ContextCompat.startForegroundService(getContext(), service);

        JSObject ret = new JSObject();
        ret.put("active", true);
        ret.put("sessionId", sessionId);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        getContext().getSharedPreferences("randoradar_native_tracker", Context.MODE_PRIVATE)
            .edit().putBoolean("active", false).apply();
        Intent service = new Intent(getContext(), NativeLocationService.class);
        getContext().stopService(service);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        android.content.SharedPreferences prefs = getContext().getSharedPreferences("randoradar_native_tracker", Context.MODE_PRIVATE);
        String sessionId = safeSession(prefs.getString("sessionId", ""));
        JSObject ret = new JSObject();
        ret.put("active", prefs.getBoolean("active", false));
        ret.put("sessionId", sessionId);
        ret.put("startedAt", prefs.getLong("startedAt", 0L));
        ret.put("mode", prefs.getString("mode", "hike"));
        ret.put("activityName", prefs.getString("activityName", ""));
        ret.put("lastServiceStartAt", prefs.getLong("lastServiceStartAt", 0L));
        File file = trackFile(sessionId);
        ret.put("trackExists", !sessionId.isEmpty() && file.exists() && file.length() > 0);
        ret.put("trackBytes", file.exists() ? file.length() : 0L);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPoints(PluginCall call) {
        String sessionId = safeSession(call.getString("sessionId", ""));
        JSArray array = new JSArray();
        File file = trackFile(sessionId);
        if (file.exists()) {
            try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.trim().isEmpty()) continue;
                    try { array.put(new JSONObject(line)); } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                call.reject("TRACK_READ_FAILED", e);
                return;
            }
        }
        JSObject ret = new JSObject();
        ret.put("points", array);
        ret.put("count", array.length());
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        ret.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(ret);
    }

    @PluginMethod
    public void clearTracking(PluginCall call) {
        String sessionId = safeSession(call.getString("sessionId", ""));
        if (!sessionId.isEmpty()) {
            File file = trackFile(sessionId);
            if (file.exists()) file.delete();
        }
        call.resolve();
    }

    private File trackFile(String sessionId) {
        return new File(getContext().getFilesDir(), "rr-track-" + safeSession(sessionId) + ".jsonl");
    }

    private void clearOldTracks() {
        File dir = getContext().getFilesDir();
        File[] files = dir.listFiles((d, name) -> name.startsWith("rr-track-") && name.endsWith(".jsonl"));
        if (files == null) return;
        for (File file : files) try { file.delete(); } catch (Exception ignored) {}
    }

    private String safeSession(String raw) {
        if (raw == null) return "";
        String clean = raw.replaceAll("[^A-Za-z0-9_-]", "");
        return clean.substring(0, Math.min(clean.length(), 80));
    }
}
`;

fs.writeFileSync(path.join(javaDir, 'NativeLocationService.java'), serviceJava);
fs.writeFileSync(path.join(javaDir, 'RandoRadarTrackerPlugin.java'), pluginJava);

const mainActivityPath = path.join(javaDir, 'MainActivity.java');
let mainActivity = fs.readFileSync(mainActivityPath, 'utf8');
if (!mainActivity.includes('registerPlugin(RandoRadarTrackerPlugin.class)')) {
  mainActivity = `package ${PACKAGE_NAME};\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(RandoRadarTrackerPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n`;
  fs.writeFileSync(mainActivityPath, mainActivity);
}

console.log(`Android configuré : Fused Location Provider haute précision, version ${VERSION_NAME}`);
