Rando Radar 1.10.20 — correction GPS écran éteint

- Remplace Android LocationManager par Google Fused Location Provider 21.4.0.
- Service de premier plan Android type location.
- Haute précision, mises à jour ~2 s, récupération des lots de positions reçus en veille.
- Les points sont toujours enregistrés nativement dans le stockage interne de l'application.
- L'interface affiche maintenant le nombre de points GPS natifs reçus pendant l'activité.
- Conserve l'interface PWA, la carte et les boutons existants.

Fichiers minimum à remplacer dans GitHub :
- package.json
- scripts/patch-android.mjs
- www/app.js

Puis Actions > Build Rando Radar APK > Run workflow.

Sur Xiaomi/HyperOS, régler aussi Rando Radar sur Batterie > Aucune restriction pour les tests longs.
