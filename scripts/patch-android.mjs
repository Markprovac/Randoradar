import fs from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = fs.readFileSync(manifestPath, 'utf8');

const permissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION'
];

for (const permission of permissions) {
  if (!manifest.includes(`android:name="${permission}"`)) {
    manifest = manifest.replace(
      '<manifest',
      `<manifest`
    );
    const pos = manifest.indexOf('>');
    manifest = manifest.slice(0, pos + 1) +
      `\n    <uses-permission android:name="${permission}" />` +
      manifest.slice(pos + 1);
  }
}

// Respecte l'orientation portrait de la PWA.
if (!manifest.includes('android:screenOrientation=')) {
  manifest = manifest.replace(
    /(<activity\b[^>]*android:name="\.MainActivity"[^>]*)(>)/s,
    '$1 android:screenOrientation="portrait"$2'
  );
}

fs.writeFileSync(manifestPath, manifest);

const gradlePath = 'android/app/build.gradle';
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode 11017');
  gradle = gradle.replace(/versionName\s+"[^"]+"/, 'versionName "1.10.17"');
  fs.writeFileSync(gradlePath, gradle);
}

console.log('Android configuré : GPS, réseau, portrait, version 1.10.17');
