Rando Radar 1.10.21 — suivi carte centré + boussole/orientation

Nouveautés :
- Le point GPS reste automatiquement au centre de la carte.
- Si tu fais glisser la carte avec un doigt, le recentrage automatique s'arrête immédiatement.
- Le bouton ◎ réactive le suivi et recentre le GPS.
- Nouveau bouton boussole N/E/S/O entre le bouton GPS et les boutons + / −.
- Mode AUTO : la carte s'oriente selon le cap (cap GPS en mouvement, boussole du téléphone à faible vitesse).
- Un appui sur la boussole verrouille la carte vers le Nord et empêche la rotation automatique.
- Un nouvel appui réactive l'orientation automatique.
- Rotation manuelle à deux doigts : le mode passe en MAN et garde l'orientation choisie.
- Le GPS natif écran éteint de la 1.10.20 est conservé.

Fichiers à remplacer dans le dépôt GitHub :
- package.json
- scripts/copy-leaflet.mjs
- scripts/patch-android.mjs
- www/index.html
- www/styles.css
- www/app.js
- www/sw.js

Puis : Actions > Build Rando Radar APK > Run workflow.
