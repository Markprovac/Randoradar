Rando Radar 1.10.19 — correction GPS écran éteint

Remplacer sur GitHub :
- package.json
- scripts/patch-android.mjs
- www/app.js
- www/index.html
- www/styles.css
- www/sw.js

Puis Actions > Build Rando Radar APK > Run workflow.

Important : cette version remplace le plugin GPS précédent par un service Android natif Rando Radar qui écrit les points dans le stockage interne pendant que l'écran est éteint. Les anciennes activités en cours provenant de la version précédente ne sont pas restaurées pour éviter de réafficher une trace corrompue.
