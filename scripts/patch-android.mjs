import fs from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
let manifest = fs.readFileSync(manifestPath, 'utf8');

const permissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION'
];

// Les <uses-permission> doivent être des enfants de <manifest>,
// donc on les insère juste avant <application> (et jamais avant la racine XML).
const missingPermissions = permissions.filter(
  permission => !manifest.includes(`android:name="${permission}"`)
);

if (missingPermissions.length) {
  const permissionXml = missingPermissions
    .map(permission => `    <uses-permission android:name="${permission}" />`)
    .join('\n');

  if (!manifest.includes('<application')) {
    throw new Error('Balise <application> introuvable dans AndroidManifest.xml');
  }

  manifest = manifest.replace(
    /\n\s*<application\b/,
    `\n${permissionXml}\n\n    <application`
  );
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
