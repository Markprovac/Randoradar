# Rando Radar — APK Android (Capacitor)

Ce projet contient la PWA Rando Radar v1.10.17 telle qu'elle a été fournie,
emballée dans une application Android avec Capacitor.

## Ce qui est conservé
- interface HTML/CSS/JS existante ;
- carte Leaflet, Topo/OSM, radar météo ;
- création et import GPX ;
- suivi d'activité et reprise locale ;
- parcours enregistrés, profil altimétrique et stockage IndexedDB.

## Adaptations APK
- nom : Rando Radar ;
- identifiant Android : `com.randoradar.app` ;
- Leaflet est embarqué dans l'APK (pas besoin d'UNPKG pour démarrer l'interface) ;
- permissions réseau + localisation Android ;
- orientation portrait ;
- icône générée depuis `icon-512.png` ;
- compilation GitHub Actions en APK autonome.

## Compiler sur GitHub
1. Envoie **tout le contenu de ce dossier** à la racine d'un dépôt GitHub.
2. Ouvre **Actions**.
3. Choisis **Build Rando Radar APK**.
4. Clique **Run workflow**.
5. Quand le build est vert, télécharge l'artifact **RandoRadar-APK**.
6. Décompresse-le et installe `RandoRadar.apk`.

## Important — GPS écran verrouillé
Cette première conversion conserve le moteur GPS actuel de la PWA
(`navigator.geolocation`). Elle transforme bien l'application en APK autonome,
mais **ne garantit pas encore l'enregistrement GPS continu lorsque Android met
l'application en veille ou la ferme en arrière-plan**.

La prochaine évolution prévue est d'ajouter un service de localisation natif
Android en premier plan (notification permanente) pour rendre le suivi
d'activité fiable écran verrouillé, sans refaire l'interface.
