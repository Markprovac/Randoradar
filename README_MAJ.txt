Rando Radar 1.10.24 — reprise complète après fermeture/réouverture

Correction principale :
- l'activité native Android devient la source de vérité à la réouverture ;
- le service conserve session, heure de départ, mode et nom de l'activité ;
- à froid ou au retour au premier plan, Rando Radar relit automatiquement l'état natif ;
- tous les points GPS du fichier natif sont rechargés et la trace rose est redessinée ;
- distance et vitesse sont recalculées à partir de ces points ;
- le compteur de temps repart à partir de l'heure de départ réelle ;
- le timer de l'interface est recréé après reprise ;
- si Android a arrêté le service mais que l'activité était encore marquée en cours, il est relancé sans effacer la trace ;
- le service Android est explicitement configuré avec stopWithTask=false.

Mise à jour minimale GitHub :
- package.json
- scripts/patch-android.mjs
- www/app.js
- www/index.html
- www/sw.js

Puis Actions > Build Rando Radar APK > Run workflow.
